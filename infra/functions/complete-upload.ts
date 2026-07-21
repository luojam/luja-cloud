import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
    type GetCommandInput,
    type GetCommandOutput,
    type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { HeadObjectCommand, S3Client, type HeadObjectCommandInput } from '@aws-sdk/client-s3';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import type { FileMetadataItem, PublicFileRecord } from './list-files';

export type GetFile = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;
export type UpdateFile = (input: UpdateCommandInput) => Promise<unknown>;
export type HeadFile = (input: HeadObjectCommandInput) => Promise<{ ContentLength?: number }>;

interface CompleteUploadDependencies {
    tableName: string;
    bucketName: string;
    getFile: GetFile;
    updateFile: UpdateFile;
    headFile: HeadFile;
    now?: () => Date;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

function response(statusCode: number, message: string) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify({ message }) };
}

function publicFile(item: FileMetadataItem): PublicFileRecord {
    return {
        fileId: item.fileId,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        modifiedAt: item.modifiedAt,
    };
}

function success(item: FileMetadataItem) {
    return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({ file: publicFile(item) }),
    };
}

function isConditionalFailure(error: unknown) {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

function isMissingObject(error: unknown) {
    if (typeof error !== 'object' || error === null) return false;
    const awsError = error as { name?: unknown; $metadata?: { httpStatusCode?: number } };
    return (
        awsError.$metadata?.httpStatusCode === 404 ||
        awsError.name === 'NotFound' ||
        awsError.name === 'NoSuchKey'
    );
}

export function createCompleteUploadHandler({
    tableName,
    bucketName,
    getFile,
    updateFile,
    headFile,
    now = () => new Date(),
}: CompleteUploadDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return response(401, 'Unauthorized');
        }
        const fileId = event.pathParameters?.id;
        if (!fileId) return response(404, 'File not found');
        if (!tableName || !bucketName) return response(500, 'Internal server error');

        const key = { ownerId: subject, fileId };
        let item: FileMetadataItem | undefined;
        try {
            item = (await getFile({ TableName: tableName, Key: key, ConsistentRead: true }))
                .Item as FileMetadataItem | undefined;
        } catch {
            return response(500, 'Internal server error');
        }

        if (!item) return response(404, 'File not found');
        if (item.status === 'ready') return success(item);
        if (item.status !== 'pending') return response(409, 'Upload cannot be completed');

        try {
            const object = await headFile({ Bucket: bucketName, Key: item.objectKey });
            if (object.ContentLength !== item.sizeBytes) {
                return response(409, 'Upload cannot be completed');
            }
        } catch (error) {
            if (isMissingObject(error)) return response(409, 'Upload cannot be completed');
            return response(500, 'Internal server error');
        }

        const modifiedAt = now().toISOString();
        try {
            await updateFile({
                TableName: tableName,
                Key: key,
                UpdateExpression: 'SET #status = :ready, #modifiedAt = :modifiedAt',
                ConditionExpression: '#status = :pending AND #objectKey = :objectKey',
                ExpressionAttributeNames: {
                    '#status': 'status',
                    '#modifiedAt': 'modifiedAt',
                    '#objectKey': 'objectKey',
                },
                ExpressionAttributeValues: {
                    ':ready': 'ready',
                    ':pending': 'pending',
                    ':modifiedAt': modifiedAt,
                    ':objectKey': item.objectKey,
                },
            });
        } catch (error) {
            if (!isConditionalFailure(error)) return response(500, 'Internal server error');

            try {
                const current = (
                    await getFile({ TableName: tableName, Key: key, ConsistentRead: true })
                ).Item as FileMetadataItem | undefined;
                if (!current) return response(404, 'File not found');
                if (current.status === 'ready') return success(current);
                return response(409, 'Upload cannot be completed');
            } catch {
                return response(500, 'Internal server error');
            }
        }

        return success({ ...item, status: 'ready', modifiedAt });
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createCompleteUploadHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    getFile: (input) => documentClient.send(new GetCommand(input)),
    updateFile: (input) => documentClient.send(new UpdateCommand(input)),
    headFile: (input) => s3Client.send(new HeadObjectCommand(input)),
});
