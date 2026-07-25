import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    ABANDONED_UPLOAD_AGE_MS,
    createCleanupAbandonedUploadsHandler,
    type ClaimFile,
    type DeleteMetadata,
    type DeleteObject,
    type ScanFiles,
} from '../functions/cleanup-abandoned-uploads';
import { createCompleteUploadHandler } from '../functions/complete-upload';
import type { FileMetadataItem } from '../functions/list-files';

const NOW = new Date('2026-02-02T00:00:00.000Z');

function file(overrides: Partial<FileMetadataItem> = {}): FileMetadataItem {
    return {
        ownerId: 'owner-secret',
        fileId: 'file-secret',
        name: 'private-name.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
        objectKey: 'files/object-secret',
        status: 'pending',
        createdAt: '2026-01-31T00:00:00.000Z',
        modifiedAt: '2026-01-31T00:00:00.000Z',
        ...overrides,
    };
}

function dependencies(items: FileMetadataItem[] = [file()]) {
    const scanFiles = jest.fn<ReturnType<ScanFiles>, Parameters<ScanFiles>>().mockResolvedValue({
        Items: items,
        ScannedCount: items.length,
    });
    const claimFile = jest.fn<ReturnType<ClaimFile>, Parameters<ClaimFile>>().mockResolvedValue({});
    const deleteObject = jest
        .fn<ReturnType<DeleteObject>, Parameters<DeleteObject>>()
        .mockResolvedValue({});
    const deleteMetadata = jest
        .fn<ReturnType<DeleteMetadata>, Parameters<DeleteMetadata>>()
        .mockResolvedValue({});
    const logger = { log: jest.fn(), error: jest.fn() };
    return { scanFiles, claimFile, deleteObject, deleteMetadata, logger };
}

async function invoke(deps = dependencies()) {
    return createCleanupAbandonedUploadsHandler({
        tableName: 'FilesTable',
        bucketName: 'FilesBucket',
        ...deps,
        now: () => NOW,
    })();
}

test('defines the abandonment window once as 24 hours', () => {
    expect(ABANDONED_UPLOAD_AGE_MS).toBe(24 * 60 * 60 * 1_000);
});

test('scans only stale pending and retryable cleanup records, leaving fresh pending and ready records untouched', async () => {
    const deps = dependencies([]);
    await invoke(deps);

    expect(deps.scanFiles).toHaveBeenCalledWith(
        expect.objectContaining({
            FilterExpression:
                '#status = :cleanup OR (#status = :pending AND #createdAt <= :cutoff)',
            ExpressionAttributeValues: {
                ':pending': 'pending',
                ':cleanup': 'cleanup',
                ':cutoff': new Date(NOW.getTime() - ABANDONED_UPLOAD_AGE_MS).toISOString(),
            },
        })
    );
    expect(deps.claimFile).not.toHaveBeenCalled();
    expect(deps.deleteObject).not.toHaveBeenCalled();
});

test('claims a stale pending record before deleting its object and metadata', async () => {
    const deps = dependencies();
    const result = await invoke(deps);

    expect(deps.claimFile).toHaveBeenCalledWith(
        expect.objectContaining({
            Key: { ownerId: 'owner-secret', fileId: 'file-secret' },
            ConditionExpression:
                '#status = :pending AND #createdAt = :createdAt AND #objectKey = :objectKey',
        })
    );
    expect(deps.deleteObject).toHaveBeenCalledWith({
        Bucket: 'FilesBucket',
        Key: 'files/object-secret',
    });
    expect(deps.deleteMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
            ConditionExpression: '#status = :cleanup AND #objectKey = :objectKey',
        })
    );
    expect(deps.claimFile.mock.invocationCallOrder[0]).toBeLessThan(
        deps.deleteObject.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({
        scanned: 1,
        candidates: 1,
        claimed: 1,
        deleted: 1,
        conflicts: 0,
        failures: 0,
    });
});

test('treats an absent S3 object as an idempotent successful delete', async () => {
    const deps = dependencies([file({ status: 'cleanup' })]);
    await expect(invoke(deps)).resolves.toEqual(expect.objectContaining({ deleted: 1 }));
    expect(deps.claimFile).not.toHaveBeenCalled();
    expect(deps.deleteMetadata).toHaveBeenCalledTimes(1);
});

test('paginates through every scan page', async () => {
    const deps = dependencies([]);
    deps.scanFiles
        .mockResolvedValueOnce({
            Items: [file()],
            ScannedCount: 10,
            LastEvaluatedKey: { ownerId: 'cursor-owner', fileId: 'cursor-file' },
        })
        .mockResolvedValueOnce({ Items: [file({ fileId: 'second' })], ScannedCount: 4 });

    const result = await invoke(deps);
    expect(deps.scanFiles).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
            ExclusiveStartKey: { ownerId: 'cursor-owner', fileId: 'cursor-file' },
        })
    );
    expect(result).toEqual(expect.objectContaining({ scanned: 14, deleted: 2 }));
});

test('leaves cleanup metadata after an S3 failure and retries it on the next run', async () => {
    let status: FileMetadataItem['status'] = 'pending';
    let objectAttempts = 0;
    const item = file();
    const deps = dependencies([]);
    deps.scanFiles.mockImplementation(async () => ({
        Items: [{ ...item, status }],
        ScannedCount: 1,
    }));
    deps.claimFile.mockImplementation(async () => {
        status = 'cleanup';
        return {};
    });
    deps.deleteObject.mockImplementation(async () => {
        objectAttempts += 1;
        if (objectAttempts === 1) throw new Error('private S3 object failure');
        return {};
    });
    deps.deleteMetadata.mockImplementation(async () => {
        status = 'ready'; // represents removal for this in-memory test
        return {};
    });

    expect(await invoke(deps)).toEqual(expect.objectContaining({ failures: 1, deleted: 0 }));
    expect(status).toBe('cleanup');
    expect(await invoke(deps)).toEqual(expect.objectContaining({ claimed: 0, deleted: 1 }));
    expect(deps.claimFile).toHaveBeenCalledTimes(1);
    expect(deps.deleteObject).toHaveBeenCalledTimes(2);
});

test.each(['claim', 'metadata'] as const)(
    'continues safely after a DynamoDB %s conditional conflict',
    async (operation) => {
        const deps = dependencies();
        deps[operation === 'claim' ? 'claimFile' : 'deleteMetadata'].mockRejectedValue({
            name: 'ConditionalCheckFailedException',
        });
        const result = await invoke(deps);
        expect(result.conflicts).toBe(1);
        if (operation === 'claim') expect(deps.deleteObject).not.toHaveBeenCalled();
    }
);

test('sanitizes operation and scan failures in logs and thrown errors', async () => {
    const operationDeps = dependencies();
    operationDeps.deleteObject.mockRejectedValue(new Error('owner-secret files/object-secret'));
    await invoke(operationDeps);
    expect(JSON.stringify(operationDeps.logger.error.mock.calls)).not.toContain('secret');

    const scanDeps = dependencies([]);
    scanDeps.scanFiles.mockRejectedValue(new Error('private scan details'));
    await expect(invoke(scanDeps)).rejects.toThrow('Abandoned upload cleanup scan failed');
    expect(JSON.stringify(scanDeps.logger.error.mock.calls)).not.toContain('private scan details');
});

function completionEvent(): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: '',
        rawPath: '',
        rawQueryString: '',
        headers: {},
        isBase64Encoded: false,
        pathParameters: { id: 'file-secret' },
        requestContext: {
            accountId: '',
            apiId: '',
            domainName: '',
            domainPrefix: '',
            requestId: '',
            routeKey: '',
            stage: '',
            time: '',
            timeEpoch: 0,
            http: { method: 'POST', path: '', protocol: '', sourceIp: '', userAgent: '' },
            authorizer: {
                principalId: '',
                integrationLatency: 0,
                jwt: { claims: { sub: 'owner-secret' }, scopes: [] },
            },
        },
    };
}

test('race is safe whether completion wins first or cleanup claims first', async () => {
    const base = file();

    let status: FileMetadataItem['status'] = 'ready';
    const completionWon = dependencies([{ ...base, status: 'pending' }]);
    completionWon.claimFile.mockImplementation(async () => {
        if (status !== 'pending') throw { name: 'ConditionalCheckFailedException' };
    });
    const firstResult = await invoke(completionWon);
    expect(firstResult.conflicts).toBe(1);
    expect(completionWon.deleteObject).not.toHaveBeenCalled();

    status = 'pending';
    const cleanupWon = dependencies([{ ...base, status: 'pending' }]);
    cleanupWon.claimFile.mockImplementation(async () => {
        if (status !== 'pending') throw { name: 'ConditionalCheckFailedException' };
        status = 'cleanup';
        return {};
    });
    cleanupWon.deleteMetadata.mockImplementation(async () => ({}));
    await invoke(cleanupWon);

    const complete = createCompleteUploadHandler({
        tableName: 'FilesTable',
        bucketName: 'FilesBucket',
        now: () => NOW,
        getFile: async () => ({ Item: { ...base, status } }),
        headFile: async () => ({ ContentLength: 4 }),
        updateFile: async () => {
            if (status !== 'pending') throw { name: 'ConditionalCheckFailedException' };
            status = 'ready';
        },
    });
    const response = await complete(completionEvent(), {} as never, jest.fn());
    if (!response || typeof response === 'string') throw new Error('Expected response');
    expect(response.statusCode).toBe(409);
    expect(status).toBe('cleanup');
});
