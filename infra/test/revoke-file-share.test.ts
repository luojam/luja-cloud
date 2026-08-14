import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { createRevokeFileShareHandler, type RevokeShare } from '../functions/revoke-file-share';

function event(subject: string | null = 'owner_1'): APIGatewayProxyEventV2WithJWTAuthorizer {
    return {
        version: '2.0',
        routeKey: 'DELETE /api/files/{id}/share',
        rawPath: '/redacted',
        rawQueryString: '',
        headers: {},
        isBase64Encoded: false,
        pathParameters: { id: 'file_1' },
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
            http: { method: 'DELETE', path: '', protocol: '', sourceIp: '', userAgent: '' },
            authorizer: {
                principalId: '',
                integrationLatency: 0,
                jwt: { claims: subject ? { sub: subject } : {}, scopes: [] },
            },
        },
    };
}

async function invoke(
    revokeShare: jest.MockedFunction<RevokeShare>,
    subject: string | null = 'owner_1'
) {
    const handler = createRevokeFileShareHandler({ filesTableName: 'Files', revokeShare });
    const result = await handler(event(subject), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('expected response');
    return result;
}

test('removes tokenHash from only the JWT owners file without creating phantom items', async () => {
    const revokeShare = jest
        .fn<ReturnType<RevokeShare>, Parameters<RevokeShare>>()
        .mockResolvedValue();
    const result = await invoke(revokeShare);
    expect(result).toEqual({ statusCode: 204, headers: { 'cache-control': 'no-store' } });
    expect(revokeShare).toHaveBeenCalledWith({
        TableName: 'Files',
        Key: { ownerId: 'owner_1', fileId: 'file_1' },
        UpdateExpression: 'REMOVE #tokenHash',
        ConditionExpression: 'attribute_exists(#ownerId)',
        ExpressionAttributeNames: { '#ownerId': 'ownerId', '#tokenHash': 'tokenHash' },
    });
});

test('treats a missing file as an idempotent successful revocation', async () => {
    const revokeShare = jest
        .fn<ReturnType<RevokeShare>, Parameters<RevokeShare>>()
        .mockRejectedValue({ name: 'ConditionalCheckFailedException' });
    expect((await invoke(revokeShare)).statusCode).toBe(204);
});

test('rejects a missing subject without touching DynamoDB', async () => {
    const revokeShare = jest.fn<ReturnType<RevokeShare>, Parameters<RevokeShare>>();
    expect((await invoke(revokeShare, null)).statusCode).toBe(401);
    expect(revokeShare).not.toHaveBeenCalled();
});

test('sanitizes non-conditional DynamoDB failures', async () => {
    const revokeShare = jest
        .fn<ReturnType<RevokeShare>, Parameters<RevokeShare>>()
        .mockRejectedValue(new Error('private hash'));
    const result = await invoke(revokeShare);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
});
