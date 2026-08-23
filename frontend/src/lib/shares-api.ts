import {
    authenticatedRequest,
    responseJson,
    type AuthenticatedRequestFailureKind,
    type GetToken,
} from '@/lib/authenticated-request';

export type ShareApiFailureKind =
    | 'authentication'
    | 'conflict'
    | 'generic'
    | 'retryable'
    | 'unavailable';

export type PublicSharedFile = {
    name: string;
    mimeType: string;
    sizeBytes: number;
};

export class ShareApiError extends Error {
    readonly kind: ShareApiFailureKind;

    constructor(kind: ShareApiFailureKind, message: string) {
        super(message);
        this.name = 'ShareApiError';
        this.kind = kind;
    }
}

function createShareApiError(kind: AuthenticatedRequestFailureKind, message: string) {
    return new ShareApiError(kind, message);
}

const publicFileKeys = ['name', 'mimeType', 'sizeBytes'] as const;
const sharePathPattern = /^\/share\/[A-Za-z0-9_-]{43}$/;
const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isPublicSharedFile(value: unknown): value is PublicSharedFile {
    if (typeof value !== 'object' || value === null) return false;

    const file = value as Record<string, unknown>;
    return (
        hasOnlyKeys(file, publicFileKeys) &&
        isNonEmptyString(file.name) &&
        file.name.length <= 255 &&
        isNonEmptyString(file.mimeType) &&
        typeof file.sizeBytes === 'number' &&
        Number.isSafeInteger(file.sizeBytes) &&
        file.sizeBytes >= 0
    );
}

function parseSharePath(value: unknown): string {
    const failureMessage = 'Unable to enable sharing. Please try again.';
    if (typeof value !== 'object' || value === null) {
        throw new ShareApiError('generic', failureMessage);
    }

    const payload = value as Record<string, unknown>;
    if (
        !hasOnlyKeys(payload, ['sharePath']) ||
        typeof payload.sharePath !== 'string' ||
        !sharePathPattern.test(payload.sharePath)
    ) {
        throw new ShareApiError('generic', failureMessage);
    }
    return payload.sharePath;
}

function parsePublicShareMetadata(value: unknown): PublicSharedFile {
    if (typeof value !== 'object' || value === null) {
        throw new ShareApiError('retryable', 'Unable to open this shared file.');
    }

    const payload = value as Record<string, unknown>;
    if (!hasOnlyKeys(payload, ['file']) || !isPublicSharedFile(payload.file)) {
        throw new ShareApiError('retryable', 'Unable to open this shared file.');
    }
    return payload.file;
}

function parsePublicShareDownload(value: unknown): string {
    const failureMessage = 'The download could not be prepared. Please try again.';
    if (typeof value !== 'object' || value === null) {
        throw new ShareApiError('retryable', failureMessage);
    }

    const payload = value as Record<string, unknown>;
    if (!hasOnlyKeys(payload, ['downloadUrl']) || !isNonEmptyString(payload.downloadUrl)) {
        throw new ShareApiError('retryable', failureMessage);
    }

    try {
        const url = new URL(payload.downloadUrl);
        if (url.protocol !== 'https:') throw new Error();
    } catch {
        throw new ShareApiError('retryable', failureMessage);
    }
    return payload.downloadUrl;
}

async function ownerRequest(
    getToken: GetToken,
    fileId: string,
    method: 'POST' | 'DELETE',
    signal: AbortSignal
): Promise<Response> {
    const failureMessage =
        method === 'POST'
            ? 'Unable to enable sharing. Please try again.'
            : 'Unable to disable sharing. Please try again.';

    return authenticatedRequest(
        getToken,
        `/api/files/${encodeURIComponent(fileId)}/share`,
        { method },
        signal,
        failureMessage,
        createShareApiError,
        {
            expectedStatus: method === 'POST' ? 201 : 204,
            getResponseError: (response) =>
                method === 'POST' && response.status === 409
                    ? new ShareApiError(
                          'conflict',
                          'Sharing changed in another request. Close this dialog and try again.'
                      )
                    : undefined,
        }
    );
}

export async function createFileShare(
    getToken: GetToken,
    fileId: string,
    signal: AbortSignal
): Promise<string> {
    const response = await ownerRequest(getToken, fileId, 'POST', signal);
    return parseSharePath(
        await responseJson(
            response,
            'Unable to enable sharing. Please try again.',
            createShareApiError
        )
    );
}

export async function revokeFileShare(
    getToken: GetToken,
    fileId: string,
    signal: AbortSignal
): Promise<void> {
    await ownerRequest(getToken, fileId, 'DELETE', signal);
}

async function publicShareRequest(
    shareToken: string,
    operation: 'metadata' | 'download',
    signal: AbortSignal
): Promise<unknown> {
    const failureMessage =
        operation === 'metadata'
            ? 'Unable to open this shared file.'
            : 'The download could not be prepared. Please try again.';
    if (!shareTokenPattern.test(shareToken)) {
        throw new ShareApiError('unavailable', 'This shared file is unavailable.');
    }

    let response: Response;
    try {
        response = await fetch(
            `/api/shares/${encodeURIComponent(shareToken)}${
                operation === 'download' ? '/download' : ''
            }`,
            {
                method: operation === 'download' ? 'POST' : 'GET',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
                signal,
            }
        );
    } catch (error) {
        if (signal.aborted) throw error;
        throw new ShareApiError('retryable', failureMessage);
    }

    if (response.status === 404) {
        throw new ShareApiError('unavailable', 'This shared file is unavailable.');
    }
    if (response.status === 429 || response.status >= 500) {
        throw new ShareApiError('retryable', failureMessage);
    }
    if (response.status !== 200) {
        throw new ShareApiError('generic', failureMessage);
    }
    return responseJson(response, failureMessage, createShareApiError);
}

export async function getPublicShareMetadata(
    shareToken: string,
    signal: AbortSignal
): Promise<PublicSharedFile> {
    return parsePublicShareMetadata(await publicShareRequest(shareToken, 'metadata', signal));
}

export async function getPublicShareDownloadUrl(
    shareToken: string,
    signal: AbortSignal
): Promise<string> {
    return parsePublicShareDownload(await publicShareRequest(shareToken, 'download', signal));
}
