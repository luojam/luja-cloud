import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    createDeleteFileHandler,
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
    const getFile = jest.fn<ReturnType<GetFile>, Parameters<GetFile>>().mockResolvedValue({
        Item: item ?? undefined,
    });
    const deleteObject = jest
        .fn<ReturnType<DeleteObject>, Parameters<DeleteObject>>()
        .mockResolvedValue();
    const deleteMetadata = jest
        .fn<ReturnType<DeleteFileMetadata>, Parameters<DeleteFileMetadata>>()
        .mockResolvedValue();
    return { getFile, deleteObject, deleteMetadata };
}

async function invoke(deps = dependencies(), subject: string | null = 'user_123') {
    const handler = createDeleteFileHandler({
        tableName: 'FilesTable',
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
    expect(deps.deleteObject).not.toHaveBeenCalled();
});

test.each([
    ['absent', null],
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
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(deps.deleteMetadata).not.toHaveBeenCalled();
});

test('deletes the exact stored object before conditionally deleting metadata', async () => {
    const deps = dependencies();
    const result = await invoke(deps);

    expect(deps.deleteObject).toHaveBeenCalledWith({
        Bucket: 'FilesBucket',
        Key: 'files/exact-stored-key',
    });
    expect(deps.deleteMetadata).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'user_123', fileId: 'file_123' },
        ConditionExpression:
            'attribute_exists(#ownerId) AND attribute_exists(#fileId) AND #status = :ready AND #objectKey = :objectKey',
        ExpressionAttributeNames: {
            '#ownerId': 'ownerId',
            '#fileId': 'fileId',
            '#status': 'status',
            '#objectKey': 'objectKey',
        },
        ExpressionAttributeValues: {
            ':ready': 'ready',
            ':objectKey': 'files/exact-stored-key',
        },
    });
    expect(deps.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
        deps.deleteMetadata.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({ statusCode: 204, headers: { 'cache-control': 'no-store' } });
    expect(result.body).toBeUndefined();
});

test('allows metadata deletion when a concurrent rename changes display fields', async () => {
    const deps = dependencies();
    deps.deleteObject.mockImplementationOnce(async () => {
        // A rename changes these fields after the consistent read but leaves object identity intact.
        const currentItem = file({
            name: 'renamed.pdf',
            modifiedAt: '2026-01-02T00:00:00.000Z',
        });
        expect(currentItem.objectKey).toBe('files/exact-stored-key');
    });

    const result = await invoke(deps);
    const deleteInput = deps.deleteMetadata.mock.calls[0][0];

    expect(deleteInput.ConditionExpression).not.toContain('modifiedAt');
    expect(deleteInput.ConditionExpression).not.toContain('createdAt');
    expect(result.statusCode).toBe(204);
});

test('does not delete metadata when S3 deletion fails', async () => {
    const deps = dependencies();
    deps.deleteObject.mockRejectedValue(new Error('private S3 details'));
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(deps.deleteMetadata).not.toHaveBeenCalled();
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});

test('a metadata failure after S3 success is sanitized and can safely retry', async () => {
    const deps = dependencies();
    deps.deleteMetadata
        .mockRejectedValueOnce(new Error('private DynamoDB details'))
        .mockResolvedValueOnce();

    const first = await invoke(deps);
    const second = await invoke(deps);
    expect(first.statusCode).toBe(500);
    expect(first.body).not.toContain('private DynamoDB details');
    expect(second.statusCode).toBe(204);
    expect(deps.deleteObject).toHaveBeenCalledTimes(2);
    expect(deps.deleteMetadata).toHaveBeenCalledTimes(2);
});

test('returns a sanitized 500 when the conditional deletion detects changed state', async () => {
    const deps = dependencies();
    deps.deleteMetadata.mockRejectedValue({
        name: 'ConditionalCheckFailedException',
        message: 'private replacement details',
    });
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});

test('sanitizes metadata read failures', async () => {
    const deps = dependencies();
    deps.getFile.mockRejectedValue(new Error('private record and object key'));
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});
