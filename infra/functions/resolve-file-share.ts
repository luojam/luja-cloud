import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    type GetCommandInput,
    type GetCommandOutput,
    type QueryCommandInput,
    type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { attachmentDisposition, type PresignDownload } from './download-helpers';
import type { FileMetadataItem } from './list-files';
import { hashShareToken } from './share-token';

interface ShareCandidate {
    ownerId: string;
    fileId: string;
    tokenHash: string;
}

export type QueryShare = (input: QueryCommandInput) => Promise<Pick<QueryCommandOutput, 'Items'>>;
export type GetItem = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;

interface ResolveFileShareDependencies {
    filesTableName: string;
    tokenHashIndexName: string;
    bucketName: string;
    queryShare: QueryShare;
    getItem: GetItem;
    presignDownload: PresignDownload;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

function unavailable() {
    return {
        statusCode: 404,
        headers: responseHeaders,
        body: JSON.stringify({ message: 'Share unavailable' }),
    };
}

function isShareCandidate(value: unknown, tokenHash: string): value is ShareCandidate {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Partial<ShareCandidate>;
    return (
        typeof item.ownerId === 'string' &&
        item.ownerId.length > 0 &&
        typeof item.fileId === 'string' &&
        item.fileId.length > 0 &&
        item.tokenHash === tokenHash
    );
}

function isAvailableFile(
    value: unknown,
    candidate: ShareCandidate,
    tokenHash: string
): value is FileMetadataItem {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Partial<FileMetadataItem>;
    return (
        item.ownerId === candidate.ownerId &&
        item.fileId === candidate.fileId &&
        item.status === 'ready' &&
        item.tokenHash === tokenHash &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0 &&
        item.name.length <= 255 &&
        typeof item.mimeType === 'string' &&
        item.mimeType.length > 0 &&
        typeof item.objectKey === 'string' &&
        item.objectKey === `files/${candidate.fileId}` &&
        typeof item.sizeBytes === 'number' &&
        Number.isSafeInteger(item.sizeBytes) &&
        item.sizeBytes >= 0
    );
}

async function resolveAvailableFile(
    token: string,
    {
        filesTableName,
        tokenHashIndexName,
        queryShare,
        getItem,
    }: Pick<
        ResolveFileShareDependencies,
        'filesTableName' | 'tokenHashIndexName' | 'queryShare' | 'getItem'
    >
): Promise<FileMetadataItem | null> {
    const tokenHash = hashShareToken(token);
    const candidates = await queryShare({
        TableName: filesTableName,
        IndexName: tokenHashIndexName,
        KeyConditionExpression: '#tokenHash = :tokenHash',
        ExpressionAttributeNames: { '#tokenHash': 'tokenHash' },
        ExpressionAttributeValues: { ':tokenHash': tokenHash },
        Limit: 2,
    });
    if (candidates.Items?.length !== 1 || !isShareCandidate(candidates.Items[0], tokenHash)) {
        return null;
    }

    const candidate = candidates.Items[0];
    // The GSI is eventually consistent. This final strong base-table read rejects stale entries
    // after revocation, token replacement, or deletion before metadata is returned or signed.
    const file = (
        await getItem({
            TableName: filesTableName,
            Key: { ownerId: candidate.ownerId, fileId: candidate.fileId },
            ConsistentRead: true,
        })
    ).Item;
    return isAvailableFile(file, candidate, tokenHash) ? file : null;
}

export function createResolveFileShareHandler({
    filesTableName,
    tokenHashIndexName,
    bucketName,
    queryShare,
    getItem,
    presignDownload,
}: ResolveFileShareDependencies): APIGatewayProxyHandlerV2 {
    return async (event) => {
        const token = event.pathParameters?.token;
        const method = event.requestContext?.http?.method;
        if (
            !token ||
            !/^[A-Za-z0-9_-]{43}$/.test(token) ||
            (method !== 'GET' && method !== 'POST')
        ) {
            return unavailable();
        }
        if (!filesTableName || !tokenHashIndexName || !bucketName) {
            return {
                statusCode: 500,
                headers: responseHeaders,
                body: JSON.stringify({ message: 'Internal server error' }),
            };
        }

        try {
            const file = await resolveAvailableFile(token, {
                filesTableName,
                tokenHashIndexName,
                queryShare,
                getItem,
            });
            if (!file) return unavailable();

            if (method === 'GET') {
                return {
                    statusCode: 200,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        file: {
                            name: file.name,
                            mimeType: file.mimeType,
                            sizeBytes: file.sizeBytes,
                        },
                    }),
                };
            }

            const downloadUrl = await presignDownload({
                bucketName,
                objectKey: file.objectKey,
                contentType: file.mimeType,
                contentDisposition: attachmentDisposition(file.name),
                expiresIn: 300,
            });
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({ downloadUrl }),
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
const s3Client = new S3Client({});

export const handler = createResolveFileShareHandler({
    filesTableName: process.env.FILES_TABLE_NAME ?? '',
    tokenHashIndexName: process.env.TOKEN_HASH_INDEX_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    queryShare: (input) => documentClient.send(new QueryCommand(input)),
    getItem: (input) => documentClient.send(new GetCommand(input)),
    presignDownload: ({ bucketName, objectKey, contentType, contentDisposition, expiresIn }) =>
        getSignedUrl(
            s3Client,
            new GetObjectCommand({
                Bucket: bucketName,
                Key: objectKey,
                ResponseContentType: contentType,
                ResponseContentDisposition: contentDisposition,
            }),
            { expiresIn }
        ),
});
