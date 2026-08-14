import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { PresignDownload } from '../functions/download-helpers';
import type { FileMetadataItem } from '../functions/list-files';
import { hashShareToken } from '../functions/share-token';
import {
    createResolveFileShareHandler,
    type GetItem,
    type QueryShare,
} from '../functions/resolve-file-share';

const token = 'A'.repeat(43);
const tokenHash = hashShareToken(token);
const candidate = { ownerId: 'owner_1', fileId: 'file_1', tokenHash };
const file: FileMetadataItem = {
    ownerId: 'owner_1',
    fileId: 'file_1',
    name: 'résumé\r\n".pdf',
    mimeType: 'application/pdf',
    sizeBytes: 42,
    objectKey: 'files/file_1',
    status: 'ready',
    createdAt: 'now',
    modifiedAt: 'now',
    tokenHash,
};

function event(value = token, method: 'GET' | 'POST' = 'GET'): APIGatewayProxyEventV2 {
    return {
        pathParameters: { token: value },
        requestContext: { http: { method } },
    } as unknown as APIGatewayProxyEventV2;
}

function deps() {
    const queryShare = jest
        .fn<ReturnType<QueryShare>, Parameters<QueryShare>>()
        .mockResolvedValue({ Items: [candidate] });
    const getItem = jest
        .fn<ReturnType<GetItem>, Parameters<GetItem>>()
        .mockResolvedValue({ Item: file });
    const presignDownload = jest
        .fn<ReturnType<PresignDownload>, Parameters<PresignDownload>>()
        .mockResolvedValue('https://signed.example/download');
    return { queryShare, getItem, presignDownload };
}

async function invoke(dependencies = deps(), value = token, method: 'GET' | 'POST' = 'GET') {
    const handler = createResolveFileShareHandler({
        filesTableName: 'Files',
        tokenHashIndexName: 'TokenHashIndex',
        bucketName: 'Bucket',
        ...dependencies,
    });
    const result = await handler(event(value, method), {} as never, jest.fn());
    if (!result || typeof result === 'string') throw new Error('expected response');
    return result;
}

function expectUnavailable(result: {
    statusCode?: number;
    body?: string;
    headers?: Record<string, string | number | boolean>;
}) {
    expect(result.statusCode).toBe(404);
    expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    expect(result.body).toBe(JSON.stringify({ message: 'Share unavailable' }));
}

test('metadata resolves on the sparse file index then strongly revalidates the file', async () => {
    const dependencies = deps();
    const result = await invoke(dependencies);
    expect(dependencies.queryShare).toHaveBeenCalledWith({
        TableName: 'Files',
        IndexName: 'TokenHashIndex',
        KeyConditionExpression: '#tokenHash = :tokenHash',
        ExpressionAttributeNames: { '#tokenHash': 'tokenHash' },
        ExpressionAttributeValues: { ':tokenHash': tokenHash },
        Limit: 2,
    });
    expect(dependencies.getItem).toHaveBeenCalledTimes(1);
    expect(dependencies.getItem).toHaveBeenCalledWith({
        TableName: 'Files',
        Key: { ownerId: 'owner_1', fileId: 'file_1' },
        ConsistentRead: true,
    });
    expect(dependencies.presignDownload).not.toHaveBeenCalled();
    expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    expect(JSON.parse(result.body ?? '')).toEqual({
        file: { name: 'résumé\r\n".pdf', mimeType: 'application/pdf', sizeBytes: 42 },
    });
});

test('download revalidates and returns only one HTTPS signed URL', async () => {
    const dependencies = deps();
    const result = await invoke(dependencies, token, 'POST');
    expect(dependencies.presignDownload).toHaveBeenCalledWith({
        bucketName: 'Bucket',
        objectKey: 'files/file_1',
        contentType: 'application/pdf',
        expiresIn: 300,
        contentDisposition: `attachment; filename="r_sum____.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9__%22.pdf`,
    });
    expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    expect(JSON.parse(result.body ?? '')).toEqual({
        downloadUrl: 'https://signed.example/download',
    });
});

test('download rejects a revoked share without signing', async () => {
    const dependencies = deps();
    dependencies.getItem.mockResolvedValue({ Item: { ...file, tokenHash: undefined } });
    expectUnavailable(await invoke(dependencies, token, 'POST'));
    expect(dependencies.presignDownload).not.toHaveBeenCalled();
});

test('returns the generic 404 for a malformed token', async () => {
    const dependencies = deps();
    expectUnavailable(await invoke(dependencies, `${token}=`));
    expect(dependencies.queryShare).not.toHaveBeenCalled();
});

test('returns the same generic 404 for an unknown token', async () => {
    const dependencies = deps();
    dependencies.queryShare.mockResolvedValue({ Items: [] });
    expectUnavailable(await invoke(dependencies));
    expect(dependencies.getItem).not.toHaveBeenCalled();
});

test('rejects duplicate token-hash candidates', async () => {
    const dependencies = deps();
    dependencies.queryShare.mockResolvedValue({
        Items: [candidate, { ...candidate, ownerId: 'owner_2' }],
    });
    expectUnavailable(await invoke(dependencies));
    expect(dependencies.getItem).not.toHaveBeenCalled();
});

test.each([
    ['missing', undefined],
    ['deleting', { ...file, status: 'deleting' as const }],
    ['mismatched owner', { ...file, ownerId: 'owner_2' }],
    ['mismatched file ID', { ...file, fileId: 'file_2' }],
    ['inconsistent object key', { ...file, objectKey: 'files/another-file' }],
    ['invalid public metadata', { ...file, sizeBytes: -1 }],
])('returns the generic 404 for a %s file', async (_label, item) => {
    const dependencies = deps();
    dependencies.getItem.mockResolvedValue({ Item: item });
    expectUnavailable(await invoke(dependencies));
    expect(dependencies.presignDownload).not.toHaveBeenCalled();
});

test('rejects a GSI candidate whose projected hash does not match the request', async () => {
    const dependencies = deps();
    dependencies.queryShare.mockResolvedValue({
        Items: [{ ...candidate, tokenHash: 'b'.repeat(64) }],
    });
    expectUnavailable(await invoke(dependencies));
    expect(dependencies.getItem).not.toHaveBeenCalled();
});

test('sanitizes storage failures without echoing the token', async () => {
    const dependencies = deps();
    dependencies.queryShare.mockRejectedValue(new Error(`private ${token}`));
    const result = await invoke(dependencies);
    expect(result.statusCode).toBe(500);
    expect(result.body).toBe(JSON.stringify({ message: 'Internal server error' }));
    expect(result.body).not.toContain(token);
});
