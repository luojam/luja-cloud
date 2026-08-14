import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
    createEnableFileShareHandler,
    type EnableShare,
    type GetFile,
} from '../functions/enable-file-share';
import type { FileMetadataItem } from '../functions/list-files';
import { SHARE_TOKEN_BYTES, generateShareToken, hashShareToken } from '../functions/share-token';

function event(subject: string | null = 'owner_1'): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'POST /api/files/{id}/share',
        rawPath: '/redacted',
        rawQueryString: '',
        headers: {},
        isBase64Encoded: false,
        pathParameters: { id: 'file_1' },
        requestContext: {
            accountId: 'x',
            apiId: 'x',
            domainName: 'x',
            domainPrefix: 'x',
            requestId: 'x',
            routeKey: 'POST /api/files/{id}/share',
            stage: '$default',
            time: '',
            timeEpoch: 0,
            http: { method: 'POST', path: '', protocol: '', sourceIp: '', userAgent: '' },
            authorizer: {
                principalId: 'x',
                integrationLatency: 0,
                jwt: { claims: subject ? { sub: subject } : {}, scopes: [] },
            },
        },
    };
}

function readyFile(): FileMetadataItem {
    return {
        ownerId: 'owner_1',
        fileId: 'file_1',
        name: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        objectKey: 'files/file_1',
        status: 'ready',
        createdAt: 'now',
        modifiedAt: 'now',
    };
}

function deps(item: FileMetadataItem | null = readyFile()) {
    const getFile = jest
        .fn<ReturnType<GetFile>, Parameters<GetFile>>()
        .mockResolvedValue({ Item: item ?? undefined });
    const enableShare = jest
        .fn<ReturnType<EnableShare>, Parameters<EnableShare>>()
        .mockResolvedValue();
    return { getFile, enableShare };
}

async function invoke(
    dependencies = deps(),
    token = 'A'.repeat(43),
    subject: string | null = 'owner_1'
) {
    const handler = createEnableFileShareHandler({
        filesTableName: 'Files',
        ...dependencies,
        generateToken: () => token,
    });
    const result = await handler(event(subject), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('expected response');
    return result;
}

test('generates an unpadded URL-safe token containing 256 bits of random input', () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(SHARE_TOKEN_BYTES);
});

test('stores only the SHA-256 hash on the ready file and returns the raw token exactly once', async () => {
    const dependencies = deps();
    const token = 'B'.repeat(43);
    const result = await invoke(dependencies, token);

    expect(result.statusCode).toBe(201);
    expect(result.headers).toEqual(expect.objectContaining({ 'cache-control': 'no-store' }));
    expect(JSON.parse(result.body ?? '')).toEqual({ sharePath: `/share/${token}` });
    expect(dependencies.enableShare).toHaveBeenCalledWith({
        TableName: 'Files',
        Key: { ownerId: 'owner_1', fileId: 'file_1' },
        UpdateExpression: 'SET #tokenHash = :tokenHash',
        ConditionExpression: '#status = :ready AND attribute_not_exists(#tokenHash)',
        ExpressionAttributeNames: {
            '#status': 'status',
            '#tokenHash': 'tokenHash',
        },
        ExpressionAttributeValues: {
            ':ready': 'ready',
            ':tokenHash': hashShareToken(token),
        },
    });
    expect(dependencies.getFile).not.toHaveBeenCalled();
    expect(JSON.stringify(dependencies.enableShare.mock.calls[0][0])).not.toContain(token);
});

test('recovers a committed update whose success response was lost', async () => {
    const dependencies = deps();
    const token = 'R'.repeat(43);
    dependencies.enableShare.mockRejectedValue(new Error('response lost'));
    dependencies.getFile.mockResolvedValue({
        Item: { ...readyFile(), tokenHash: hashShareToken(token) },
    });

    const result = await invoke(dependencies, token);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body ?? '')).toEqual({ sharePath: `/share/${token}` });
    expect(dependencies.getFile).toHaveBeenCalledTimes(1);
});

test('returns a token-free conflict when another enable or deletion update wins', async () => {
    const dependencies = deps();
    dependencies.enableShare.mockRejectedValue({
        name: 'ConditionalCheckFailedException',
        message: 'raw private state',
    });
    const token = 'C'.repeat(43);
    const result = await invoke(dependencies, token);
    expect(result.statusCode).toBe(409);
    expect(result.body).toBe(JSON.stringify({ message: 'Sharing state changed' }));
    expect(result.body).not.toContain(token);
    expect(result.body).not.toContain('private');
});

test('keeps non-conditional DynamoDB failures as server errors', async () => {
    const dependencies = deps();
    dependencies.enableShare.mockRejectedValue({ name: 'ProvisionedThroughputExceededException' });
    const result = await invoke(dependencies);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});

test.each([null, { ...readyFile(), status: 'pending' as const }])(
    'does not enable a missing or non-ready owned file',
    async (item) => {
        const dependencies = deps(item);
        dependencies.enableShare.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
        expect((await invoke(dependencies)).statusCode).toBe(404);
        expect(dependencies.enableShare).toHaveBeenCalledTimes(1);
    }
);

test('isolates ownership using only the JWT subject', async () => {
    const dependencies = deps(null);
    dependencies.enableShare.mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    await invoke(dependencies, 'D'.repeat(43), 'different_owner');
    expect(dependencies.enableShare).toHaveBeenCalledWith(
        expect.objectContaining({
            Key: { ownerId: 'different_owner', fileId: 'file_1' },
        })
    );
    expect(dependencies.getFile).toHaveBeenCalledWith({
        TableName: 'Files',
        Key: { ownerId: 'different_owner', fileId: 'file_1' },
        ConsistentRead: true,
    });
});
