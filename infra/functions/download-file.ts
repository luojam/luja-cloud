import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    type GetCommandInput,
    type GetCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import type { FileMetadataItem } from './list-files';

export type GetFile = (input: GetCommandInput) => Promise<Pick<GetCommandOutput, 'Item'>>;
export type PresignDownload = (input: {
    bucketName: string;
    objectKey: string;
    contentType: string;
    contentDisposition: string;
    expiresIn: number;
}) => Promise<string>;

interface DownloadFileDependencies {
    tableName: string;
    bucketName: string;
    getFile: GetFile;
    presignDownload: PresignDownload;
}

const responseHeaders = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
};

function response(statusCode: number, body: Record<string, string>) {
    return { statusCode, headers: responseHeaders, body: JSON.stringify(body) };
}

/** Builds an RFC 6266 disposition without allowing metadata to add another header/value. */
export function attachmentDisposition(fileName: string): string {
    const visibleName =
        fileName
            .normalize('NFC')
            .replace(/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/g, '_')
            .replace(/[\\/]/g, '_')
            .trim() || 'download';
    const asciiName = visibleName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(visibleName).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );

    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

export function createDownloadFileHandler({
    tableName,
    bucketName,
    getFile,
    presignDownload,
}: DownloadFileDependencies): APIGatewayProxyHandlerV2WithJWTAuthorizer {
    return async (event) => {
        const subject = event.requestContext.authorizer.jwt.claims.sub;
        if (typeof subject !== 'string' || subject.trim().length === 0) {
            return response(401, { message: 'Unauthorized' });
        }

        const fileId = event.pathParameters?.id;
        if (!fileId) return response(404, { message: 'File not found' });
        if (!tableName || !bucketName) {
            return response(500, { message: 'Internal server error' });
        }

        try {
            const item = (
                await getFile({
                    TableName: tableName,
                    Key: { ownerId: subject, fileId },
                    ConsistentRead: true,
                })
            ).Item as FileMetadataItem | undefined;

            // Missing, non-owned (which cannot match this key), and incomplete files are identical.
            if (!item || item.status !== 'ready') {
                return response(404, { message: 'File not found' });
            }

            const downloadUrl = await presignDownload({
                bucketName,
                objectKey: item.objectKey,
                contentType: item.mimeType,
                contentDisposition: attachmentDisposition(item.name),
                expiresIn: 300,
            });

            return response(200, { downloadUrl });
        } catch {
            return response(500, { message: 'Internal server error' });
        }
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createDownloadFileHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    getFile: (input) => documentClient.send(new GetCommand(input)),
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
