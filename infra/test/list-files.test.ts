import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    createListFilesHandler,
    type FileMetadataItem,
    type QueryFiles,
} from '../functions/list-files';

function eventWithSubject(subject?: string): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'GET /api/files',
        rawPath: '/api/files',
        rawQueryString: '',
        headers: {},
        requestContext: {
            accountId: 'test-account',
            apiId: 'test-api',
            domainName: 'example.test',
            domainPrefix: 'example',
            http: {
                method: 'GET',
                path: '/api/files',
                protocol: 'HTTP/1.1',
                sourceIp: '127.0.0.1',
                userAgent: 'jest',
            },
            requestId: 'test-request',
            routeKey: 'GET /api/files',
            stage: '$default',
            time: '01/Jan/2026:00:00:00 +0000',
            timeEpoch: 0,
            authorizer: {
                principalId: 'user_123',
                integrationLatency: 0,
                jwt: {
                    claims: subject === undefined ? {} : { sub: subject },
                    scopes: [],
                },
            },
        },
        isBase64Encoded: false,
    };
}

function readyFile(overrides: Partial<FileMetadataItem> = {}): FileMetadataItem {
    return {
        ownerId: 'user_123',
        fileId: 'file_123',
        name: 'example.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        objectKey: 'files/file_123',
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-02T00:00:00.000Z',
        ...overrides,
    };
}

function queryMock(): jest.MockedFunction<QueryFiles> {
    return jest.fn() as jest.MockedFunction<QueryFiles>;
}

async function invoke(
    query: jest.MockedFunction<QueryFiles>,
    subject: string | undefined = 'user_123'
) {
    const handler = createListFilesHandler({ tableName: 'FilesTable', query });
    const result = await handler(eventWithSubject(subject), {} as never, jest.fn());

    if (!result || typeof result === 'string') {
        throw new Error('Expected an API Gateway response');
    }

    return result;
}

test('returns an empty file array when the owner has no ready records', async () => {
    const query = queryMock().mockResolvedValue({ Items: [] });

    const result = await invoke(query);

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    expect(JSON.parse(result.body ?? '')).toEqual({ files: [] });
});

test('queries only the owner ID from the verified JWT subject', async () => {
    const query = queryMock().mockResolvedValue({ Items: [] });

    await invoke(query, 'user_from_jwt');

    expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
            KeyConditionExpression: '#ownerId = :ownerId',
            ExpressionAttributeValues: {
                ':ownerId': 'user_from_jwt',
                ':ready': 'ready',
            },
        })
    );
});

test('returns ready records using only public fields and excludes pending and cleanup states', async () => {
    const query = queryMock().mockResolvedValue({
        Items: [
            readyFile(),
            readyFile({ fileId: 'pending', status: 'pending' }),
            readyFile({ fileId: 'cleanup', status: 'cleanup' }),
        ],
    });

    const result = await invoke(query);

    expect(JSON.parse(result.body ?? '')).toEqual({
        files: [
            {
                fileId: 'file_123',
                name: 'example.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 123,
                createdAt: '2026-01-01T00:00:00.000Z',
                modifiedAt: '2026-01-02T00:00:00.000Z',
            },
        ],
    });
    expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
            FilterExpression: '#status = :ready',
        })
    );
});

test('continues after an empty filtered page and reads subsequent pages', async () => {
    const query = queryMock()
        .mockResolvedValueOnce({
            Items: [],
            LastEvaluatedKey: { ownerId: 'user_123', fileId: 'a' },
        })
        .mockResolvedValueOnce({ Items: [readyFile({ fileId: 'b' })] });

    const result = await invoke(query);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0].ExclusiveStartKey).toEqual({
        ownerId: 'user_123',
        fileId: 'a',
    });
    expect(JSON.parse(result.body ?? '').files).toHaveLength(1);
});

test.each(['', '   '])('rejects an empty JWT subject', async (subject) => {
    const query = queryMock();

    const result = await invoke(query, subject);

    expect(result.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
});

test('rejects a missing JWT subject', async () => {
    const query = queryMock();
    const handler = createListFilesHandler({ tableName: 'FilesTable', query });

    const result = await handler(eventWithSubject(), {} as never, jest.fn());

    expect(result).toEqual(
        expect.objectContaining({
            statusCode: 401,
        })
    );
    expect(query).not.toHaveBeenCalled();
});

test('returns a generic server error when DynamoDB fails', async () => {
    const query = queryMock().mockRejectedValue(new Error('record details'));

    const result = await invoke(query);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body ?? '')).toEqual({ message: 'Internal server error' });
    expect(result.body).not.toContain('record details');
});
