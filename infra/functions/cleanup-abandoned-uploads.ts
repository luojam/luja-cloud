import { DeleteObjectCommand, S3Client, type DeleteObjectCommandInput } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
    type DeleteCommandInput,
    type ScanCommandInput,
    type ScanCommandOutput,
    type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { FileMetadataItem } from './list-files';

/** Pending uploads at least this old are abandoned. */
export const ABANDONED_UPLOAD_AGE_MS = 24 * 60 * 60 * 1_000;

export type ScanFiles = (
    input: ScanCommandInput
) => Promise<Pick<ScanCommandOutput, 'Items' | 'LastEvaluatedKey' | 'ScannedCount'>>;
export type ClaimFile = (input: UpdateCommandInput) => Promise<unknown>;
export type DeleteObject = (input: DeleteObjectCommandInput) => Promise<unknown>;
export type DeleteMetadata = (input: DeleteCommandInput) => Promise<unknown>;

interface CleanupDependencies {
    tableName: string;
    bucketName: string;
    scanFiles: ScanFiles;
    claimFile: ClaimFile;
    deleteObject: DeleteObject;
    deleteMetadata: DeleteMetadata;
    now?: () => Date;
    logger?: Pick<Console, 'log' | 'error'>;
}

export interface CleanupCounts {
    scanned: number;
    candidates: number;
    claimed: number;
    deleted: number;
    conflicts: number;
    failures: number;
}

function isConditionalFailure(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
    );
}

function isCandidate(item: unknown): item is FileMetadataItem {
    if (typeof item !== 'object' || item === null) return false;
    const value = item as Partial<FileMetadataItem>;
    return (
        (value.status === 'pending' || value.status === 'cleanup' || value.status === 'deleting') &&
        typeof value.ownerId === 'string' &&
        typeof value.fileId === 'string' &&
        typeof value.objectKey === 'string' &&
        typeof value.createdAt === 'string'
    );
}

export function createCleanupAbandonedUploadsHandler({
    tableName,
    bucketName,
    scanFiles,
    claimFile,
    deleteObject,
    deleteMetadata,
    now = () => new Date(),
    logger = console,
}: CleanupDependencies) {
    return async (): Promise<CleanupCounts> => {
        if (!tableName || !bucketName) throw new Error('Cleanup is not configured');

        const counts: CleanupCounts = {
            scanned: 0,
            candidates: 0,
            claimed: 0,
            deleted: 0,
            conflicts: 0,
            failures: 0,
        };
        const cutoff = new Date(now().getTime() - ABANDONED_UPLOAD_AGE_MS).toISOString();
        let exclusiveStartKey: Record<string, unknown> | undefined;

        try {
            do {
                const page = await scanFiles({
                    TableName: tableName,
                    FilterExpression:
                        '#status = :cleanup OR #status = :deleting OR (#status = :pending AND #createdAt <= :cutoff)',
                    ProjectionExpression: '#ownerId, #fileId, #objectKey, #status, #createdAt',
                    ExpressionAttributeNames: {
                        '#ownerId': 'ownerId',
                        '#fileId': 'fileId',
                        '#objectKey': 'objectKey',
                        '#status': 'status',
                        '#createdAt': 'createdAt',
                    },
                    ExpressionAttributeValues: {
                        ':pending': 'pending',
                        ':cleanup': 'cleanup',
                        ':deleting': 'deleting',
                        ':cutoff': cutoff,
                    },
                    ExclusiveStartKey: exclusiveStartKey,
                });
                counts.scanned += page.ScannedCount ?? 0;

                for (const candidate of page.Items ?? []) {
                    if (!isCandidate(candidate)) {
                        counts.failures += 1;
                        logger.error('Abandoned upload cleanup operation failed', {
                            operation: 'validate',
                        });
                        continue;
                    }
                    counts.candidates += 1;
                    const key = { ownerId: candidate.ownerId, fileId: candidate.fileId };
                    const cleanupStatus =
                        candidate.status === 'pending' ? 'cleanup' : candidate.status;

                    if (candidate.status === 'pending') {
                        try {
                            await claimFile({
                                TableName: tableName,
                                Key: key,
                                UpdateExpression: 'SET #status = :cleanup',
                                ConditionExpression:
                                    '#status = :pending AND #createdAt = :createdAt AND #objectKey = :objectKey',
                                ExpressionAttributeNames: {
                                    '#status': 'status',
                                    '#createdAt': 'createdAt',
                                    '#objectKey': 'objectKey',
                                },
                                ExpressionAttributeValues: {
                                    ':pending': 'pending',
                                    ':cleanup': 'cleanup',
                                    ':createdAt': candidate.createdAt,
                                    ':objectKey': candidate.objectKey,
                                },
                            });
                            counts.claimed += 1;
                        } catch (error) {
                            if (isConditionalFailure(error)) {
                                counts.conflicts += 1;
                            } else {
                                counts.failures += 1;
                                logger.error('Abandoned upload cleanup operation failed', {
                                    operation: 'claim',
                                });
                            }
                            continue;
                        }
                    }

                    try {
                        // DeleteObject is idempotent: an absent object is a successful cleanup.
                        await deleteObject({ Bucket: bucketName, Key: candidate.objectKey });
                    } catch {
                        counts.failures += 1;
                        logger.error('Abandoned upload cleanup operation failed', {
                            operation: 'object-delete',
                        });
                        continue;
                    }

                    try {
                        await deleteMetadata({
                            TableName: tableName,
                            Key: key,
                            ConditionExpression:
                                '#status = :expectedStatus AND #objectKey = :objectKey',
                            ExpressionAttributeNames: {
                                '#status': 'status',
                                '#objectKey': 'objectKey',
                            },
                            ExpressionAttributeValues: {
                                ':expectedStatus': cleanupStatus,
                                ':objectKey': candidate.objectKey,
                            },
                        });
                        counts.deleted += 1;
                    } catch (error) {
                        if (isConditionalFailure(error)) counts.conflicts += 1;
                        else {
                            counts.failures += 1;
                            logger.error('Abandoned upload cleanup operation failed', {
                                operation: 'metadata-delete',
                            });
                        }
                    }
                }

                exclusiveStartKey = page.LastEvaluatedKey;
            } while (exclusiveStartKey);
        } catch {
            logger.error('Abandoned upload cleanup scan failed');
            throw new Error('Abandoned upload cleanup scan failed');
        } finally {
            logger.log('Abandoned upload cleanup completed', counts);
        }

        return counts;
    };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createCleanupAbandonedUploadsHandler({
    tableName: process.env.FILES_TABLE_NAME ?? '',
    bucketName: process.env.FILES_BUCKET_NAME ?? '',
    scanFiles: (input) => documentClient.send(new ScanCommand(input)),
    claimFile: (input) => documentClient.send(new UpdateCommand(input)),
    deleteObject: (input) => s3Client.send(new DeleteObjectCommand(input)),
    deleteMetadata: (input) => documentClient.send(new DeleteCommand(input)),
});
