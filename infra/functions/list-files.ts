import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    type QueryCommandInput,
    type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';

export interface FileMetadataItem {
    ownerId: string;
    fileId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    objectKey: string;
    status: 'pending' | 'ready';
    createdAt: string;
    modifiedAt: string;
}

export interface PublicFileRecord {
    fileId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    modifiedAt: string;
}

export interface ListFilesResponse {
    files: PublicFileRecord[];
}

export type QueryFiles = (
    input: QueryCommandInput
) => Promise<Pick<QueryCommandOutput, 'Items' | 'LastEvaluatedKey'>>;

interface ListFilesHandlerDependencies {
    tableName: string;
    query: QueryFiles;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

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

export function createListFilesHandler({
    tableName,
    query,
}: ListFilesHandlerDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;

        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return {
                statusCode: 401,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Unauthorized' }),
            };
        }

        if (!tableName) {
            return {
                statusCode: 500,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Internal server error' }),
            };
        }

        try {
            const files: PublicFileRecord[] = [];
            let exclusiveStartKey: Record<string, unknown> | undefined;

            do {
                const result = await query({
                    TableName: tableName,
                    KeyConditionExpression: '#ownerId = :ownerId',
                    FilterExpression: '#status = :ready',
                    ExpressionAttributeNames: {
                        '#ownerId': 'ownerId',
                        '#status': 'status',
                    },
                    ExpressionAttributeValues: {
                        ':ownerId': subject,
                        ':ready': 'ready',
                    },
                    ExclusiveStartKey: exclusiveStartKey,
                });

                for (const item of result.Items ?? []) {
                    const file = item as FileMetadataItem;
                    if (file.status === 'ready') {
                        files.push(publicFile(file));
                    }
                }

                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            const body: ListFilesResponse = { files };
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify(body),
            };
        } catch {
            return {
                statusCode: 500,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Internal server error' }),
            };
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = createListFilesHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    query: (input) => documentClient.send(new QueryCommand(input)),
});
