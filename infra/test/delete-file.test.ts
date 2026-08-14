import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    createDeleteFileHandler,
    type ClaimFileDeletion,
    type DeleteFileMetadata,
    type DeleteObject,
    type GetFile,
} from '../functions/delete-file';
import type { FileMetadataItem } from '../functions/list-files';

function event(subject: string | null = 'user_123'): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'DELETE /api/files/{id}',
        rawPath: '/api/files/file_123',
        rawQueryString: '',
        headers: {},
        isBase64Encoded: false,
        pathParameters: { id: 'file_123' },
        requestContext: {
            accountId: 'test',
            apiId: 'test',
            domainName: 'test',
            domainPrefix: 'test',
            requestId: 'test',
            routeKey: 'DELETE /api/files/{id}',
            stage: '$default',
            time: '',
            timeEpoch: 0,
            http: { method: 'DELETE', path: '', protocol: 'HTTP/1.1', sourceIp: '', userAgent: '' },
            authorizer: {
                principalId: 'test',
                integrationLatency: 0,
                jwt: { claims: subject === null ? {} : { sub: subject }, scopes: [] },
            },
        },
    };
}

function file(overrides: Partial<FileMetadataItem> = {}): FileMetadataItem {
    return {
        ownerId: 'user_123',
        fileId: 'file_123',
        name: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        objectKey: 'files/exact-stored-key',
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function dependencies(item: FileMetadataItem | null = file()) {
    const getFile = jest
        .fn<ReturnType<GetFile>, Parameters<GetFile>>()
        .mockResolvedValue({ Item: item ?? undefined });
    const claimDeletion = jest
        .fn<ReturnType<ClaimFileDeletion>, Parameters<ClaimFileDeletion>>()
        .mockResolvedValue();
    const deleteObject = jest
        .fn<ReturnType<DeleteObject>, Parameters<DeleteObject>>()
        .mockResolvedValue();
    const deleteMetadata = jest
        .fn<ReturnType<DeleteFileMetadata>, Parameters<DeleteFileMetadata>>()
        .mockResolvedValue();
    return { getFile, claimDeletion, deleteObject, deleteMetadata };
}

async function invoke(deps = dependencies(), subject: string | null = 'user_123') {
    const handler = createDeleteFileHandler({
        filesTableName: 'FilesTable',
        bucketName: 'FilesBucket',
        ...deps,
    });
    const result = await handler(event(subject), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('Expected response');
    return result;
}

test('rejects a missing subject before accessing storage', async () => {
    const deps = dependencies();
    expect((await invoke(deps, null)).statusCode).toBe(401);
    expect(deps.getFile).not.toHaveBeenCalled();
    expect(deps.claimDeletion).not.toHaveBeenCalled();
});

test.each([
    ['non-owned', null],
    ['pending', file({ status: 'pending' })],
] as const)('returns the same 404 for an %s record', async (_case, item) => {
    const deps = dependencies(item);
    const result = await invoke(deps, 'owner_from_jwt');
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body ?? '')).toEqual({ message: 'File not found' });
    expect(deps.getFile).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'owner_from_jwt', fileId: 'file_123' },
        ConsistentRead: true,
    });
    expect(deps.claimDeletion).not.toHaveBeenCalled();
    expect(deps.deleteObject).not.toHaveBeenCalled();
});

test('atomically claims the file and removes tokenHash before deleting bytes and metadata', async () => {
    const deps = dependencies();
    const result = await invoke(deps);

    expect(deps.claimDeletion).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'user_123', fileId: 'file_123' },
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
            ':objectKey': 'files/exact-stored-key',
        },
    });
    expect(deps.deleteObject).toHaveBeenCalledWith({
        Bucket: 'FilesBucket',
        Key: 'files/exact-stored-key',
    });
    expect(deps.deleteMetadata).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'user_123', fileId: 'file_123' },
        ConditionExpression: '#status = :deleting AND #objectKey = :objectKey',
        ExpressionAttributeNames: { '#status': 'status', '#objectKey': 'objectKey' },
        ExpressionAttributeValues: {
            ':deleting': 'deleting',
            ':objectKey': 'files/exact-stored-key',
        },
    });
    expect(deps.claimDeletion.mock.invocationCallOrder[0]).toBeLessThan(
        deps.deleteObject.mock.invocationCallOrder[0]
    );
    expect(deps.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
        deps.deleteMetadata.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({ statusCode: 204, headers: { 'cache-control': 'no-store' } });
});

test('retries a previously claimed deletion without another update', async () => {
    const deps = dependencies(file({ status: 'deleting' }));
    expect((await invoke(deps)).statusCode).toBe(204);
    expect(deps.claimDeletion).not.toHaveBeenCalled();
    expect(deps.deleteObject).toHaveBeenCalledTimes(1);
    expect(deps.deleteMetadata).toHaveBeenCalledTimes(1);
});

test('continues when another request claims deletion first', async () => {
    const deps = dependencies();
    deps.getFile.mockResolvedValueOnce({ Item: file() });
    deps.getFile.mockResolvedValueOnce({ Item: file({ status: 'deleting' }) });
    deps.claimDeletion.mockRejectedValue({ name: 'ConditionalCheckFailedException' });

    expect((await invoke(deps)).statusCode).toBe(204);
    expect(deps.getFile).toHaveBeenCalledTimes(2);
    expect(deps.deleteObject).toHaveBeenCalledTimes(1);
    expect(deps.deleteMetadata).toHaveBeenCalledTimes(1);
});

test('succeeds when another request finishes deletion after the initial read', async () => {
    const deps = dependencies();
    deps.getFile.mockResolvedValueOnce({ Item: file() });
    deps.getFile.mockResolvedValueOnce({ Item: undefined });
    deps.claimDeletion.mockRejectedValue({ name: 'ConditionalCheckFailedException' });

    expect((await invoke(deps)).statusCode).toBe(204);
    expect(deps.getFile).toHaveBeenCalledTimes(2);
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(deps.deleteMetadata).not.toHaveBeenCalled();
});

test('succeeds when cleanup removes deleting metadata concurrently', async () => {
    const deps = dependencies(file({ status: 'deleting' }));
    deps.getFile.mockResolvedValueOnce({ Item: file({ status: 'deleting' }) });
    deps.getFile.mockResolvedValueOnce({ Item: undefined });
    deps.deleteMetadata.mockRejectedValue({ name: 'ConditionalCheckFailedException' });

    expect((await invoke(deps)).statusCode).toBe(204);
    expect(deps.getFile).toHaveBeenCalledTimes(2);
    expect(deps.deleteObject).toHaveBeenCalledTimes(1);
    expect(deps.deleteMetadata).toHaveBeenCalledTimes(1);
});

test('does not hide a conditional failure while metadata still exists', async () => {
    const deps = dependencies(file({ status: 'deleting' }));
    deps.deleteMetadata.mockRejectedValue({ name: 'ConditionalCheckFailedException' });

    expect((await invoke(deps)).statusCode).toBe(500);
    expect(deps.getFile).toHaveBeenCalledTimes(2);
});

test('returns a sanitized error for a non-conditional metadata deletion failure', async () => {
    const deps = dependencies(file({ status: 'deleting' }));
    deps.deleteMetadata.mockRejectedValue(new Error('private metadata failure'));

    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});

test('does not remove metadata when object deletion fails and returns only a sanitized error', async () => {
    const deps = dependencies();
    deps.deleteObject.mockRejectedValue(new Error('private bucket and key details'));
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
    expect(deps.deleteMetadata).not.toHaveBeenCalled();
});

test('does not touch storage after a failed deletion claim', async () => {
    const deps = dependencies();
    deps.claimDeletion.mockRejectedValue({
        name: 'ProvisionedThroughputExceededException',
        message: 'private state',
    });
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('private state');
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(deps.deleteMetadata).not.toHaveBeenCalled();
});
