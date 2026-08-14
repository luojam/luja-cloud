import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { createRenameFileHandler, type GetFile, type UpdateFile } from '../functions/rename-file';
import type { FileMetadataItem } from '../functions/list-files';

function event(
    body: string | undefined = JSON.stringify({ name: ' renamed.pdf ' }),
    subject: string | null = 'user_123'
): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'PATCH /api/files/{id}',
        rawPath: '/api/files/file_123',
        rawQueryString: '',
        headers: {},
        body,
        isBase64Encoded: false,
        pathParameters: { id: 'file_123' },
        requestContext: {
            accountId: 'test',
            apiId: 'test',
            domainName: 'test',
            domainPrefix: 'test',
            requestId: 'test',
            routeKey: 'PATCH /api/files/{id}',
            stage: '$default',
            time: '',
            timeEpoch: 0,
            http: { method: 'PATCH', path: '', protocol: 'HTTP/1.1', sourceIp: '', userAgent: '' },
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
        name: 'original.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        objectKey: 'files/unchanged-object-key',
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
    const updateFile = jest
        .fn<ReturnType<UpdateFile>, Parameters<UpdateFile>>()
        .mockImplementation(async (input) => ({
            Attributes: {
                ...(item ?? file()),
                name: input.ExpressionAttributeValues?.[':name'],
                modifiedAt: input.ExpressionAttributeValues?.[':modifiedAt'],
            },
        }));
    return { getFile, updateFile };
}

async function invoke(
    deps = dependencies(),
    requestEvent: APIGatewayProxyEventV2WithJWTAuthorizer = event()
) {
    const handler = createRenameFileHandler({
        tableName: 'FilesTable',
        ...deps,
        now: () => new Date('2026-01-02T00:00:00.000Z'),
    });
    const result = await handler(requestEvent, {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('Expected response');
    return result;
}

test.each([
    ['missing body', null],
    ['malformed JSON', '{'],
    ['array', '[]'],
    ['extra property', JSON.stringify({ name: 'file.pdf', ownerId: 'someone' })],
    ['non-string name', JSON.stringify({ name: 123 })],
    ['empty name', JSON.stringify({ name: '   ' })],
    ['too-long name', JSON.stringify({ name: 'a'.repeat(256) })],
] as const)('rejects a %s', async (_case, body) => {
    const deps = dependencies();
    const requestEvent = event(body ?? undefined);
    if (body === null) delete requestEvent.body;
    const result = await invoke(deps, requestEvent);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? '')).toEqual({ message: 'Invalid request' });
    expect(deps.getFile).not.toHaveBeenCalled();
    expect(deps.updateFile).not.toHaveBeenCalled();
});

test('rejects a missing subject before accessing metadata', async () => {
    const deps = dependencies();
    expect((await invoke(deps, event(undefined, null))).statusCode).toBe(401);
    expect(deps.getFile).not.toHaveBeenCalled();
});

test.each([
    ['non-owned', null],
    ['pending', file({ status: 'pending' })],
] as const)('returns a generic 404 for a %s record', async (_case, item) => {
    const deps = dependencies(item);
    const result = await invoke(deps, event(JSON.stringify({ name: 'new.pdf' }), 'jwt_owner'));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body ?? '')).toEqual({ message: 'File not found' });
    expect(deps.getFile).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'jwt_owner', fileId: 'file_123' },
        ConsistentRead: true,
    });
    expect(deps.updateFile).not.toHaveBeenCalled();
});

test('trims and conditionally updates only the visible name and modified timestamp', async () => {
    const deps = dependencies();
    const result = await invoke(deps);

    expect(deps.updateFile).toHaveBeenCalledWith({
        TableName: 'FilesTable',
        Key: { ownerId: 'user_123', fileId: 'file_123' },
        UpdateExpression: 'SET #name = :name, #modifiedAt = :modifiedAt',
        ConditionExpression:
            'attribute_exists(#ownerId) AND attribute_exists(#fileId) AND #status = :ready',
        ExpressionAttributeNames: {
            '#ownerId': 'ownerId',
            '#fileId': 'fileId',
            '#status': 'status',
            '#name': 'name',
            '#modifiedAt': 'modifiedAt',
        },
        ExpressionAttributeValues: {
            ':ready': 'ready',
            ':name': 'renamed.pdf',
            ':modifiedAt': '2026-01-02T00:00:00.000Z',
        },
        ReturnValues: 'ALL_NEW',
    });
    expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    expect(JSON.parse(result.body ?? '')).toEqual({
        file: {
            fileId: 'file_123',
            name: 'renamed.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 123,
            createdAt: '2026-01-01T00:00:00.000Z',
            modifiedAt: '2026-01-02T00:00:00.000Z',
        },
    });
    expect(JSON.parse(result.body ?? '')).not.toEqual(
        expect.objectContaining({ ownerId: expect.anything(), objectKey: expect.anything() })
    );
});

test('maps a conditional update failure to the same generic 404', async () => {
    const deps = dependencies();
    deps.updateFile.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    const result = await invoke(deps);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body ?? '')).toEqual({ message: 'File not found' });
});

test.each(['get', 'update'] as const)('sanitizes unexpected %s failures', async (operation) => {
    const deps = dependencies();
    deps[operation === 'get' ? 'getFile' : 'updateFile'].mockRejectedValue(
        new Error('private AWS details')
    );
    const result = await invoke(deps);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});
