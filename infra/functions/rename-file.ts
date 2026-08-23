import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
    type GetCommandInput,
    type GetCommandOutput,
    type UpdateCommandInput,
    type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import type { BasePublicFileRecord, FileMetadataItem } from './list-files';

export type GetFile = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;
export type UpdateFile = (
    input: UpdateCommandInput
) => Promise<Pick<UpdateCommandOutput, 'Attributes'>>;

interface RenameFileDependencies {
    tableName: string;
    getFile: GetFile;
    updateFile: UpdateFile;
    now?: () => Date;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

function response(statusCode: number, message: string) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify({ message }) };
}

function publicFile(item: FileMetadataItem): BasePublicFileRecord {
    return {
        fileId: item.fileId,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        modifiedAt: item.modifiedAt,
    };
}

function parseName(body: string | undefined, isBase64Encoded: boolean): string | null {
    if (body === undefined) return null;

    try {
        const decodedBody = isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
        const value: unknown = JSON.parse(decodedBody);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

        const request = value as Record<string, unknown>;
        if (Object.keys(request).length !== 1 || typeof request.name !== 'string') return null;

        const name = request.name.trim();
        if (name.length === 0 || name.length > 255) return null;
        return name;
    } catch {
        return null;
    }
}

function isConditionalFailure(error: unknown) {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

export function createRenameFileHandler({
    tableName,
    getFile,
    updateFile,
    now = () => new Date(),
}: RenameFileDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return response(401, 'Unauthorized');
        }

        const fileId = event.pathParameters?.id;
        if (!fileId) return response(404, 'File not found');
        const name = parseName(event.body, event.isBase64Encoded);
        if (name === null) return response(400, 'Invalid request');
        if (!tableName) return response(500, 'Internal server error');

        const key = { ownerId: subject, fileId };
        try {
            const item = (await getFile({ TableName: tableName, Key: key, ConsistentRead: true }))
                .Item as FileMetadataItem | undefined;
            if (item?.status !== 'ready') return response(404, 'File not found');

            const modifiedAt = now().toISOString();
            const updated = await updateFile({
                TableName: tableName,
                Key: key,
                UpdateExpression: 'SET #name = :name, #modifiedAt = :modifiedAt',
                ConditionExpression:
                    'attribute_exists(#ownerId) AND attribute_exists(#fileId) AND #status = :ready',
                ExpressionAttributeNames: {
                    '#ownerId': 'ownerId',
                    '#fileId': 'fileId',
                    '#status': 'status',
                    '#name': 'name',
                    '#modifiedAt': 'modifiedAt',
                },
                ExpressionAttributeValues: {
                    ':ready': 'ready',
                    ':name': name,
                    ':modifiedAt': modifiedAt,
                },
                ReturnValues: 'ALL_NEW',
            });

            const updatedItem = updated.Attributes as FileMetadataItem | undefined;
            if (!updatedItem) throw new Error('Update returned no record');
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({ file: publicFile(updatedItem) }),
            };
        } catch (error) {
            if (isConditionalFailure(error)) return response(404, 'File not found');
            return response(500, 'Internal server error');
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = createRenameFileHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    getFile: (input) => documentClient.send(new GetCommand(input)),
    updateFile: (input) => documentClient.send(new UpdateCommand(input)),
});
