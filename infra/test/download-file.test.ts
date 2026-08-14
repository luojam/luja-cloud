import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { attachmentDisposition, type PresignDownload } from '../functions/download-helpers';
import { createDownloadFileHandler, type GetFile } from '../functions/download-file';
import type { FileMetadataItem } from '../functions/list-files';

function event(subject: string | null = 'user_123'): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'GET /api/files/{id}/download',
        rawPath: '/api/files/file_123/download',
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
            routeKey: 'GET /api/files/{id}/download',
            stage: '$default',
            time: '',
            timeEpoch: 0,
            http: { method: 'GET', path: '', protocol: 'HTTP/1.1', sourceIp: '', userAgent: '' },
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
        name: 'résumé "final".pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4,
        objectKey: 'files/stored-key',
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
    const presignDownload = jest
        .fn<ReturnType<PresignDownload>, Parameters<PresignDownload>>()
        .mockResolvedValue('https://bucket.example.test/signed');
    return { getFile, presignDownload };
}

async function invoke(deps = dependencies(), subject: string | null = 'user_123') {
    const handler = createDownloadFileHandler({
        tableName: 'FilesTable',
        bucketName: 'FilesBucket',
        ...deps,
    });
    const result = await handler(event(subject), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('Expected response');
    return result;
}

test('rejects a missing subject before accessing metadata', async () => {
    const deps = dependencies();
    expect((await invoke(deps, null)).statusCode).toBe(401);
    expect(deps.getFile).not.toHaveBeenCalled();
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
    expect(deps.presignDownload).not.toHaveBeenCalled();
});

test('signs the stored key for five minutes and returns only the URL', async () => {
    const deps = dependencies();
    const result = await invoke(deps);
    expect(deps.presignDownload).toHaveBeenCalledWith({
        bucketName: 'FilesBucket',
        objectKey: 'files/stored-key',
        contentType: 'application/pdf',
        contentDisposition: expect.stringContaining(
            "filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf"
        ),
        expiresIn: 300,
    });
    expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    expect(JSON.parse(result.body ?? '')).toEqual({
        downloadUrl: 'https://bucket.example.test/signed',
    });
});

test('encodes Unicode and neutralizes quotes, slashes, controls, and CR/LF in dispositions', () => {
    const disposition = attachmentDisposition('你好/evil"\r\nX-Test: injected.txt');
    expect(disposition).toContain('filename="___evil___X-Test: injected.txt"');
    expect(disposition).toContain(
        "filename*=UTF-8''%E4%BD%A0%E5%A5%BD_evil%22__X-Test%3A%20injected.txt"
    );
    expect(disposition).not.toMatch(/[\r\n]/);
});

test.each(['database', 'signer'])('sanitizes %s failures', async (operation) => {
    const deps = dependencies();
    (operation === 'database' ? deps.getFile : deps.presignDownload).mockRejectedValue(
        new Error('private AWS details')
    );
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('private AWS details');
    expect(result.body).not.toContain('signed');
});
