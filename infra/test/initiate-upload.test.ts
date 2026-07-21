import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    createInitiateUploadHandler,
    MAX_FILE_SIZE_BYTES,
    type PresignUpload,
    type PutFile,
} from '../functions/initiate-upload';

function event(
    body: string | undefined,
    subject: string | null = 'user_123',
    type = 'application/json'
): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'POST /api/files/uploads',
        rawPath: '/api/files/uploads',
        rawQueryString: '',
        headers: { 'content-type': type },
        body,
        isBase64Encoded: false,
        requestContext: {
            accountId: 'test',
            apiId: 'test',
            domainName: 'test',
            domainPrefix: 'test',
            requestId: 'test',
            routeKey: 'POST /api/files/uploads',
            stage: '$default',
            time: '',
            timeEpoch: 0,
            http: {
                method: 'POST',
                path: '/api/files/uploads',
                protocol: 'HTTP/1.1',
                sourceIp: '',
                userAgent: '',
            },
            authorizer: {
                principalId: 'test',
                integrationLatency: 0,
                jwt: { claims: subject === null ? {} : { sub: subject }, scopes: [] },
            },
        },
    };
}

const validBody = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
        name: ' photo.jpg ',
        mimeType: 'image/jpeg',
        sizeBytes: 123,
        ...overrides,
    });

function dependencies() {
    const putFile = jest.fn<ReturnType<PutFile>, Parameters<PutFile>>().mockResolvedValue({});
    const presignUpload = jest
        .fn<ReturnType<PresignUpload>, Parameters<PresignUpload>>()
        .mockResolvedValue('https://bucket.example/upload');
    return { putFile, presignUpload };
}

async function invoke(body = validBody(), subject: string | null = 'user_123') {
    const deps = dependencies();
    const handler = createInitiateUploadHandler({
        tableName: 'FilesTable',
        bucketName: 'FilesBucket',
        ...deps,
        createId: () => 'generated-id',
        now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = await handler(event(body, subject), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('Expected response');
    return { result, ...deps };
}

test('rejects a missing subject before writing metadata', async () => {
    const { result, putFile } = await invoke(validBody(), null);
    expect(result.statusCode).toBe(401);
    expect(putFile).not.toHaveBeenCalled();
});

test.each([
    [undefined, 'application/json'],
    ['{', 'application/json'],
    [validBody(), 'text/plain'],
    [
        JSON.stringify({ name: 'a', mimeType: 'text/plain', sizeBytes: 1, extra: true }),
        'application/json',
    ],
])('rejects malformed, non-JSON, and unexpected request shapes', async (body, type) => {
    const deps = dependencies();
    const handler = createInitiateUploadHandler({ tableName: 't', bucketName: 'b', ...deps });
    const result = await handler(event(body, 'user', type), {} as never, jest.fn());
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }));
    expect(deps.putFile).not.toHaveBeenCalled();
});

test.each([
    validBody({ name: '   ' }),
    validBody({ name: 'a'.repeat(256) }),
    validBody({ mimeType: 'not-a-type' }),
    validBody({ mimeType: `text/${'a'.repeat(251)}` }),
    validBody({ sizeBytes: -1 }),
    validBody({ sizeBytes: 1.5 }),
    validBody({ sizeBytes: MAX_FILE_SIZE_BYTES + 1 }),
])('rejects filename, MIME, and size values outside their boundaries', async (body) => {
    expect((await invoke(body)).result.statusCode).toBe(400);
});

test.each([0, MAX_FILE_SIZE_BYTES])('accepts size boundary %s', async (sizeBytes) => {
    expect((await invoke(validBody({ sizeBytes }))).result.statusCode).toBe(201);
});

test('normalizes a missing MIME type', async () => {
    const body = JSON.stringify({ name: 'empty', sizeBytes: 0 });
    expect((await invoke(body)).result.statusCode).toBe(201);
});

test('normalizes empty MIME, trims name, uses generated object key, and conditionally writes', async () => {
    const { result, putFile, presignUpload } = await invoke(validBody({ mimeType: '' }));
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body ?? '')).toEqual({
        fileId: 'generated-id',
        uploadUrl: 'https://bucket.example/upload',
    });
    expect(putFile).toHaveBeenCalledWith(
        expect.objectContaining({
            Item: expect.objectContaining({
                ownerId: 'user_123',
                fileId: 'generated-id',
                name: 'photo.jpg',
                mimeType: 'application/octet-stream',
                objectKey: 'files/generated-id',
                status: 'pending',
            }),
            ConditionExpression: 'attribute_not_exists(#ownerId) AND attribute_not_exists(#fileId)',
        })
    );
    expect(presignUpload).toHaveBeenCalledWith({
        bucketName: 'FilesBucket',
        objectKey: 'files/generated-id',
        mimeType: 'application/octet-stream',
        sizeBytes: 123,
        expiresIn: 300,
    });
});

test('sanitizes conditional-write and signing failures', async () => {
    const deps = dependencies();
    deps.putFile.mockRejectedValue(new Error('private AWS details'));
    const handler = createInitiateUploadHandler({ tableName: 't', bucketName: 'b', ...deps });
    const result = await handler(event(validBody()), {} as never, jest.fn());
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }));
    expect(typeof result !== 'string' && result?.body).not.toContain('private AWS details');
});
