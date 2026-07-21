import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, type PutCommandInput } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_NAME_LENGTH = 255;
const MAX_MIME_TYPE_LENGTH = 255;
const MIME_TYPE_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type PutFile = (input: PutCommandInput) => Promise<unknown>;
export type PresignUpload = (input: {
    bucketName: string;
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    expiresIn: number;
}) => Promise<string>;

interface InitiateUploadDependencies {
    tableName: string;
    bucketName: string;
    putFile: PutFile;
    presignUpload: PresignUpload;
    createId?: () => string;
    now?: () => Date;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

function response(statusCode: number, message: string) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify({ message }) };
}

function contentType(headers: Record<string, string | undefined>) {
    const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type');
    return entry?.[1]?.split(';', 1)[0].trim().toLowerCase();
}

function parseRequest(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]) {
    if (contentType(event.headers) !== 'application/json' || !event.body || event.isBase64Encoded) {
        return undefined;
    }

    let value: unknown;
    try {
        value = JSON.parse(event.body);
    } catch {
        return undefined;
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
        keys.length < 2 ||
        keys.length > 3 ||
        !keys.includes('name') ||
        !keys.includes('sizeBytes') ||
        keys.some((key) => !['name', 'mimeType', 'sizeBytes'].includes(key))
    ) {
        return undefined;
    }

    if (
        typeof record.name !== 'string' ||
        (record.mimeType !== undefined && typeof record.mimeType !== 'string')
    ) {
        return undefined;
    }
    const name = record.name.trim();
    const mimeType = record.mimeType?.trim() || 'application/octet-stream';
    if (
        name.length < 1 ||
        name.length > MAX_NAME_LENGTH ||
        mimeType.length > MAX_MIME_TYPE_LENGTH ||
        !MIME_TYPE_PATTERN.test(mimeType) ||
        typeof record.sizeBytes !== 'number' ||
        !Number.isSafeInteger(record.sizeBytes) ||
        record.sizeBytes < 0 ||
        record.sizeBytes > MAX_FILE_SIZE_BYTES
    ) {
        return undefined;
    }

    return { name, mimeType, sizeBytes: record.sizeBytes };
}

export function createInitiateUploadHandler({
    tableName,
    bucketName,
    putFile,
    presignUpload,
    createId = randomUUID,
    now = () => new Date(),
}: InitiateUploadDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return response(401, 'Unauthorized');
        }

        const request = parseRequest(event);
        if (!request) return response(400, 'Invalid request');
        if (!tableName || !bucketName) return response(500, 'Internal server error');

        const fileId = createId();
        const objectKey = `files/${fileId}`;
        const timestamp = now().toISOString();

        try {
            await putFile({
                TableName: tableName,
                Item: {
                    ownerId: subject,
                    fileId,
                    ...request,
                    objectKey,
                    status: 'pending',
                    createdAt: timestamp,
                    modifiedAt: timestamp,
                },
                ConditionExpression:
                    'attribute_not_exists(#ownerId) AND attribute_not_exists(#fileId)',
                ExpressionAttributeNames: {
                    '#ownerId': 'ownerId',
                    '#fileId': 'fileId',
                },
            });
            const uploadUrl = await presignUpload({
                bucketName,
                objectKey,
                mimeType: request.mimeType,
                sizeBytes: request.sizeBytes,
                expiresIn: 300,
            });

            return {
                statusCode: 201,
                headers: responseHeaders,
                body: JSON.stringify({ fileId, uploadUrl }),
            };
        } catch {
            return response(500, 'Internal server error');
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// Do not add the SDK's default checksum for an empty command body: the browser supplies the
// body after signing. ContentLength is signed instead so S3 rejects a body of another size.
const s3Client = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });

export const handler = createInitiateUploadHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    putFile: (input) => documentClient.send(new PutCommand(input)),
    presignUpload: ({ bucketName, objectKey, mimeType, sizeBytes, expiresIn }) =>
        getSignedUrl(
            s3Client,
            new PutObjectCommand({
                Bucket: bucketName,
                Key: objectKey,
                ContentType: mimeType,
                ContentLength: sizeBytes,
            }),
            { expiresIn }
        ),
});
