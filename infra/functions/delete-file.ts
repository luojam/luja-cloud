import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
    type DeleteCommandInput,
    type GetCommandInput,
    type GetCommandOutput,
    type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client, type DeleteObjectCommandInput } from '@aws-sdk/client-s3';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import type { FileMetadataItem } from './list-files';

export type GetFile = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;
export type DeleteObject = (input: DeleteObjectCommandInput) => Promise<void>;
export type DeleteFileMetadata = (input: DeleteCommandInput) => Promise<void>;
export type ClaimFileDeletion = (input: UpdateCommandInput) => Promise<void>;

interface DeleteFileDependencies {
    filesTableName: string;
    bucketName: string;
    getFile: GetFile;
    claimDeletion: ClaimFileDeletion;
    deleteObject: DeleteObject;
    deleteMetadata: DeleteFileMetadata;
}

const responseHeaders = { 'cache-control': 'no-store' };

function response(statusCode: number, message: string) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify({ message }) };
}

function isConditionalFailure(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

export function createDeleteFileHandler({
    filesTableName,
    bucketName,
    getFile,
    claimDeletion,
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
        if (!filesTableName || !bucketName) return response(500, 'Internal server error');

        const key = { ownerId: subject, fileId };
        try {
            let item = (
                await getFile({ TableName: filesTableName, Key: key, ConsistentRead: true })
            ).Item as FileMetadataItem | undefined;
            if (!item || (item.status !== 'ready' && item.status !== 'deleting')) {
                return response(404, 'File not found');
            }

            if (item.status === 'ready') {
                try {
                    // Sharing state lives on this item, so claiming deletion and revoking its link
                    // are one atomic update. Enable cannot commit once the status changes.
                    await claimDeletion({
                        TableName: filesTableName,
                        Key: key,
                        UpdateExpression: 'SET #status = :deleting REMOVE #tokenHash',
                        ConditionExpression: '#status = :ready AND #objectKey = :objectKey',
                        ExpressionAttributeNames: {
                            '#status': 'status',
                            '#objectKey': 'objectKey',
                            '#tokenHash': 'tokenHash',
                        },
                        ExpressionAttributeValues: {
                            ':ready': 'ready',
                            ':deleting': 'deleting',
                            ':objectKey': item.objectKey,
                        },
                    });
                } catch (error) {
                    if (!isConditionalFailure(error)) throw error;

                    const current = (
                        await getFile({
                            TableName: filesTableName,
                            Key: key,
                            ConsistentRead: true,
                        })
                    ).Item as FileMetadataItem | undefined;
                    if (!current) return { statusCode: 204, headers: responseHeaders };
                    if (current.status !== 'deleting') throw error;
                    item = current;
                }
            }

            await deleteObject({ Bucket: bucketName, Key: item.objectKey });
            try {
                await deleteMetadata({
                    TableName: filesTableName,
                    Key: key,
                    ConditionExpression: '#status = :deleting AND #objectKey = :objectKey',
                    ExpressionAttributeNames: {
                        '#status': 'status',
                        '#objectKey': 'objectKey',
                    },
                    ExpressionAttributeValues: {
                        ':deleting': 'deleting',
                        ':objectKey': item.objectKey,
                    },
                });
            } catch (error) {
                if (!isConditionalFailure(error)) throw error;

                const current = await getFile({
                    TableName: filesTableName,
                    Key: key,
                    ConsistentRead: true,
                });
                if (current.Item) throw error;
            }

            return { statusCode: 204, headers: responseHeaders };
        } catch {
            return response(500, 'Internal server error');
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createDeleteFileHandler({
    filesTableName: process.env.FILES_TABLE_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    getFile: (input) => documentClient.send(new GetCommand(input)),
    claimDeletion: async (input) => {
        await documentClient.send(new UpdateCommand(input));
    },
    deleteObject: async (input) => {
        await s3Client.send(new DeleteObjectCommand(input));
    },
    deleteMetadata: async (input) => {
        await documentClient.send(new DeleteCommand(input));
    },
});
