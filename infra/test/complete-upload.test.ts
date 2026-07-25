import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    createCompleteUploadHandler,
    type GetFile,
    type HeadFile,
    type UpdateFile,
} from '../functions/complete-upload';
import type { FileMetadataItem } from '../functions/list-files';

function event(
    subject: string | null = 'user_123',
    id = 'file_123'
): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'POST /api/files/{id}/complete',
        rawPath: `/api/files/${id}/complete`,
        rawQueryString: '',
        headers: {},
        isBase64Encoded: false,
        pathParameters: { id },
        requestContext: {
            accountId: 'test',
            apiId: 'test',
            domainName: 'test',
            domainPrefix: 'test',
            requestId: 'test',
            routeKey: 'POST /api/files/{id}/complete',
            stage: '$default',
            time: '',
            timeEpoch: 0,
            http: { method: 'POST', path: '', protocol: 'HTTP/1.1', sourceIp: '', userAgent: '' },
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
        name: 'file.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
        objectKey: 'files/file_123',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function dependencies(item: FileMetadataItem | null = file()) {
    const getFile = jest.fn<ReturnType<GetFile>, Parameters<GetFile>>().mockResolvedValue({
        Item: item ?? undefined,
    });
    const updateFile = jest
        .fn<ReturnType<UpdateFile>, Parameters<UpdateFile>>()
        .mockResolvedValue({});
    const headFile = jest
        .fn<ReturnType<HeadFile>, Parameters<HeadFile>>()
        .mockResolvedValue({ ContentLength: 4 });
    return { getFile, updateFile, headFile };
}

async function invoke(deps = dependencies(), subject: string | null = 'user_123') {
    const handler = createCompleteUploadHandler({
        tableName: 'FilesTable',
        bucketName: 'FilesBucket',
        ...deps,
        now: () => new Date('2026-01-02T00:00:00.000Z'),
    });
    const result = await handler(event(subject), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('Expected response');
    return result;
}

test('rejects a missing subject without looking up a record', async () => {
    const deps = dependencies();
    expect((await invoke(deps, null)).statusCode).toBe(401);
    expect(deps.getFile).not.toHaveBeenCalled();
});

test('uses the JWT owner and path ID and hides absent or non-owned records', async () => {
    const deps = dependencies(null);
    const result = await invoke(deps, 'owner_from_jwt');
    expect(result.statusCode).toBe(404);
    expect(deps.getFile).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'owner_from_jwt', fileId: 'file_123' },
        ConsistentRead: true,
    });
    expect(deps.headFile).not.toHaveBeenCalled();
});

test('returns ready records idempotently without checking S3 or updating', async () => {
    const deps = dependencies(file({ status: 'ready' }));
    const result = await invoke(deps);
    expect(result.statusCode).toBe(200);
    expect(deps.headFile).not.toHaveBeenCalled();
    expect(deps.updateFile).not.toHaveBeenCalled();
});

test('does not complete an internally claimed cleanup record', async () => {
    const deps = dependencies(file({ status: 'cleanup' }));
    expect((await invoke(deps)).statusCode).toBe(409);
    expect(deps.headFile).not.toHaveBeenCalled();
    expect(deps.updateFile).not.toHaveBeenCalled();
});

test('leaves a pending record unchanged when the S3 object is missing', async () => {
    const deps = dependencies();
    deps.headFile.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    expect((await invoke(deps)).statusCode).toBe(409);
    expect(deps.updateFile).not.toHaveBeenCalled();
});

test('leaves a pending record unchanged on an uploaded size mismatch', async () => {
    const deps = dependencies();
    deps.headFile.mockResolvedValue({ ContentLength: 5 });
    expect((await invoke(deps)).statusCode).toBe(409);
    expect(deps.updateFile).not.toHaveBeenCalled();
});

test('heads the generated object and conditionally transitions a matching upload to ready', async () => {
    const deps = dependencies();
    const result = await invoke(deps);
    expect(deps.headFile).toHaveBeenCalledWith({ Bucket: 'FilesBucket', Key: 'files/file_123' });
    expect(deps.updateFile).toHaveBeenCalledWith(
        expect.objectContaining({
            Key: { ownerId: 'user_123', fileId: 'file_123' },
            ConditionExpression: '#status = :pending AND #objectKey = :objectKey',
        })
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toEqual({
        file: {
            fileId: 'file_123',
            name: 'file.txt',
            mimeType: 'text/plain',
            sizeBytes: 4,
            createdAt: '2026-01-01T00:00:00.000Z',
            modifiedAt: '2026-01-02T00:00:00.000Z',
        },
    });
});

test('treats a concurrent ready transition as successful', async () => {
    const deps = dependencies();
    deps.updateFile.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    deps.getFile
        .mockResolvedValueOnce({ Item: file() })
        .mockResolvedValueOnce({ Item: file({ status: 'ready' }) });
    expect((await invoke(deps)).statusCode).toBe(200);
});

test.each(['get', 'head', 'update'] as const)(
    'sanitizes unexpected AWS %s failures',
    async (operation) => {
        const deps = dependencies();
        deps[
            operation === 'get' ? 'getFile' : operation === 'head' ? 'headFile' : 'updateFile'
        ].mockRejectedValue(new Error('private AWS details'));
        const result = await invoke(deps);
        expect(result.statusCode).toBe(500);
        expect(result.body).not.toContain('private AWS details');
    }
);
