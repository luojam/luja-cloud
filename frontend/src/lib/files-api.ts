import type { FileRecord } from '@/lib/files';

export type FilesApiFailureKind = 'authentication' | 'retryable' | 'generic';

type GetToken = () => Promise<string | null>;

export class FilesApiError extends Error {
    readonly kind: FilesApiFailureKind;

    constructor(kind: FilesApiFailureKind) {
        super('Unable to load files.');
        this.name = 'FilesApiError';
        this.kind = kind;
    }
}

const fileRecordKeys = [
    'fileId',
    'name',
    'mimeType',
    'sizeBytes',
    'createdAt',
    'modifiedAt',
] as const;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isFileRecord(value: unknown): value is FileRecord {
    if (typeof value !== 'object' || value === null) return false;

    const record = value as Record<string, unknown>;
    return (
        hasOnlyKeys(record, fileRecordKeys) &&
        isNonEmptyString(record.fileId) &&
        isNonEmptyString(record.name) &&
        isNonEmptyString(record.mimeType) &&
        typeof record.sizeBytes === 'number' &&
        Number.isSafeInteger(record.sizeBytes) &&
        record.sizeBytes >= 0 &&
        isTimestamp(record.createdAt) &&
        isTimestamp(record.modifiedAt)
    );
}

function parseFilesPayload(value: unknown): FileRecord[] {
    if (typeof value !== 'object' || value === null) throw new FilesApiError('generic');

    const payload = value as Record<string, unknown>;
    if (!hasOnlyKeys(payload, ['files']) || !Array.isArray(payload.files)) {
        throw new FilesApiError('generic');
    }
    if (!payload.files.every(isFileRecord)) throw new FilesApiError('generic');

    return payload.files;
}

export async function listFiles(getToken: GetToken, signal: AbortSignal): Promise<FileRecord[]> {
    let token: string | null;

    try {
        token = await getToken();
    } catch {
        if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        throw new FilesApiError('generic');
    }

    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (!token) throw new FilesApiError('authentication');

    let response: Response;
    try {
        response = await fetch('/api/files', {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new FilesApiError('retryable');
    }

    if (response.status === 401 || response.status === 403) {
        throw new FilesApiError('authentication');
    }
    if (response.status >= 500) throw new FilesApiError('retryable');
    if (!response.ok) throw new FilesApiError('generic');

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new FilesApiError('generic');
    }

    return parseFilesPayload(payload);
}
