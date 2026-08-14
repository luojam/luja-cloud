import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
    type GetCommandInput,
    type GetCommandOutput,
    type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import type { FileMetadataItem } from './list-files';
import { generateShareToken, hashShareToken } from './share-token';

export type GetFile = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;
export type EnableShare = (input: UpdateCommandInput) => Promise<void>;

interface EnableFileShareDependencies {
    filesTableName: string;
    getFile: GetFile;
    enableShare: EnableShare;
    generateToken?: () => string;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

function response(statusCode: number, body: Record<string, string>) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify(body) };
}

function isConditionalFailure(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

export function createEnableFileShareHandler({
    filesTableName,
    getFile,
    enableShare,
    generateToken = generateShareToken,
}: EnableFileShareDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return response(401, { message: 'Unauthorized' });
        }

        const fileId = event.pathParameters?.id;
        if (!fileId) return response(404, { message: 'File not found' });
        if (!filesTableName) return response(500, { message: 'Internal server error' });

        let token: string;
        try {
            token = generateToken();
        } catch {
            return response(500, { message: 'Internal server error' });
        }
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
            return response(500, { message: 'Internal server error' });
        }

        const key = { ownerId: subject, fileId };
        const tokenHash = hashShareToken(token);
        try {
            // One item update serializes enable with concurrent enables and deletion. Only the
            // request that stores the active hash may return its raw token.
            await enableShare({
                TableName: filesTableName,
                Key: key,
                UpdateExpression: 'SET #tokenHash = :tokenHash',
                ConditionExpression: '#status = :ready AND attribute_not_exists(#tokenHash)',
                ExpressionAttributeNames: {
                    '#status': 'status',
                    '#tokenHash': 'tokenHash',
                },
                ExpressionAttributeValues: {
                    ':ready': 'ready',
                    ':tokenHash': tokenHash,
                },
            });
            return response(201, { sharePath: `/share/${token}` });
        } catch (error) {
            try {
                // Classify a condition failure and recover an ambiguous committed update so an
                // active link is never left without its raw token.
                const current = (
                    await getFile({ TableName: filesTableName, Key: key, ConsistentRead: true })
                ).Item as FileMetadataItem | undefined;
                if (current?.status === 'ready' && current.tokenHash === tokenHash) {
                    return response(201, { sharePath: `/share/${token}` });
                }
                if (isConditionalFailure(error)) {
                    return !current || current.status !== 'ready'
                        ? response(404, { message: 'File not found' })
                        : response(409, { message: 'Sharing state changed' });
                }
            } catch {
                // Fall through to the same sanitized storage error.
            }
            return response(500, { message: 'Internal server error' });
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = createEnableFileShareHandler({
    filesTableName: process.env.FILES_TABLE_NAME ?? '',
    getFile: (input) => documentClient.send(new GetCommand(input)),
    enableShare: async (input) => {
        await documentClient.send(new UpdateCommand(input));
    },
});
