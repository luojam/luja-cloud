import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    UpdateCommand,
    type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';

export type RevokeShare = (input: UpdateCommandInput) => Promise<void>;

interface RevokeFileShareDependencies {
    filesTableName: string;
    revokeShare: RevokeShare;
}

const responseHeaders = { 'cache-control': 'no-store' };

function isConditionalFailure(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

export function createRevokeFileShareHandler({
    filesTableName,
    revokeShare,
}: RevokeFileShareDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return {
                statusCode: 401,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Unauthorized' }),
            };
        }

        const fileId = event.pathParameters?.id;
        if (!fileId) {
            return {
                statusCode: 404,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'File not found' }),
            };
        }
        if (!filesTableName) {
            return {
                statusCode: 500,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Internal server error' }),
            };
        }

        try {
            // Requiring the file to exist avoids creating a key-only item. Removing a missing
            // tokenHash is still a successful idempotent revocation.
            await revokeShare({
                TableName: filesTableName,
                Key: { ownerId: subject, fileId },
                UpdateExpression: 'REMOVE #tokenHash',
                ConditionExpression: 'attribute_exists(#ownerId)',
                ExpressionAttributeNames: {
                    '#ownerId': 'ownerId',
                    '#tokenHash': 'tokenHash',
                },
            });
            return { statusCode: 204, headers: responseHeaders };
        } catch (error) {
            if (isConditionalFailure(error)) {
                return { statusCode: 204, headers: responseHeaders };
            }
            return {
                statusCode: 500,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Internal server error' }),
            };
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = createRevokeFileShareHandler({
    filesTableName: process.env.FILES_TABLE_NAME ?? '',
    revokeShare: async (input) => {
        await documentClient.send(new UpdateCommand(input));
    },
});
