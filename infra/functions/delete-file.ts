import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    type DeleteCommandInput,
    type GetCommandInput,
    type GetCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client, type DeleteObjectCommandInput } from '@aws-sdk/client-s3';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import type { FileMetadataItem } from './list-files';

export type GetFile = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;
export type DeleteObject = (input: DeleteObjectCommandInput) => Promise<void>;
export type DeleteFileMetadata = (input: DeleteCommandInput) => Promise<void>;

interface DeleteFileDependencies {
    tableName: string;
    bucketName: string;
    getFile: GetFile;
    deleteObject: DeleteObject;
    deleteMetadata: DeleteFileMetadata;
}

const responseHeaders = { 'cache-control': 'no-store' };

function response(statusCode: number, message: string) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify({ message }) };
}

function isConditionalFailure(error: unknown) {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

export function createDeleteFileHandler({
    tableName,
    bucketName,
    getFile,
    deleteObject,
    deleteMetadata,
}: DeleteFileDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return response(401, 'Unauthorized');
        }

        const fileId = event.pathParameters?.id;
        if (!fileId) return response(404, 'File not found');
        if (!tableName || !bucketName) return response(500, 'Internal server error');

        const key = { ownerId: subject, fileId };
        try {
            const item = (await getFile({ TableName: tableName, Key: key, ConsistentRead: true }))
                .Item as FileMetadataItem | undefined;
            if (!item || item.status !== 'ready') return response(404, 'File not found');

            // Delete bytes first. DeleteObject is idempotent, so a metadata failure can be retried.
            await deleteObject({ Bucket: bucketName, Key: item.objectKey });
            await deleteMetadata({
                TableName: tableName,
                Key: key,
                ConditionExpression:
                    'attribute_exists(#ownerId) AND attribute_exists(#fileId) AND #status = :ready AND #objectKey = :objectKey',
                ExpressionAttributeNames: {
                    '#ownerId': 'ownerId',
                    '#fileId': 'fileId',
                    '#status': 'status',
                    '#objectKey': 'objectKey',
                },
                ExpressionAttributeValues: {
                    ':ready': 'ready',
                    ':objectKey': item.objectKey,
                },
            });

            return { statusCode: 204, headers: responseHeaders };
        } catch (error) {
            // The file was removed or replaced after the read, so do not delete its metadata.
            if (isConditionalFailure(error)) return response(500, 'Internal server error');
            return response(500, 'Internal server error');
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createDeleteFileHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    getFile: (input) => documentClient.send(new GetCommand(input)),
    deleteObject: async (input) => {
        await s3Client.send(new DeleteObjectCommand(input));
    },
    deleteMetadata: async (input) => {
        await documentClient.send(new DeleteCommand(input));
    },
});
