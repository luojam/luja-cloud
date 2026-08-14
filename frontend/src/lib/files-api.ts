import {
    authenticatedRequest,
    responseJson,
    type AuthenticatedRequestFailureKind,
    type GetToken,
} from '@/lib/authenticated-request';
import type { FileRecord } from '@/lib/files';

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_UPLOAD_MIME_TYPE = 'application/octet-stream';

export type FilesApiFailureKind = 'authentication' | 'retryable' | 'generic';

type InitiatedUpload = {
    fileId: string;
    uploadUrl: string;
};

export class FilesApiError extends Error {
    readonly kind: FilesApiFailureKind;

    constructor(kind: FilesApiFailureKind, message = 'Unable to load files.') {
        super(message);
        this.name = 'FilesApiError';
        this.kind = kind;
    }
}

function createFilesApiError(kind: AuthenticatedRequestFailureKind, message: string) {
    return new FilesApiError(kind, message);
}

const baseFileRecordKeys = [
    'fileId',
    'name',
    'mimeType',
    'sizeBytes',
    'createdAt',
    'modifiedAt',
] as const;
const fileRecordKeys = [...baseFileRecordKeys, 'isShared'] as const;

type BaseFileRecord = Omit<FileRecord, 'isShared'>;

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

function isBaseFileRecord(value: unknown): value is BaseFileRecord {
    if (typeof value !== 'object' || value === null) return false;

    const record = value as Record<string, unknown>;
    return (
        hasOnlyKeys(record, baseFileRecordKeys) &&
        isNonEmptyString(record.fileId) &&
        isNonEmptyString(record.name) &&
        record.name.length <= 255 &&
        isNonEmptyString(record.mimeType) &&
        typeof record.sizeBytes === 'number' &&
        Number.isSafeInteger(record.sizeBytes) &&
        record.sizeBytes >= 0 &&
        isTimestamp(record.createdAt) &&
        isTimestamp(record.modifiedAt)
    );
}

function isFileRecord(value: unknown): value is FileRecord {
    if (typeof value !== 'object' || value === null) return false;

    const record = value as Record<string, unknown>;
    if (!hasOnlyKeys(record, fileRecordKeys) || typeof record.isShared !== 'boolean') return false;

    return isBaseFileRecord({
        fileId: record.fileId,
        name: record.name,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
        modifiedAt: record.modifiedAt,
    });
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

function parseFilePayload(value: unknown, failureMessage: string): BaseFileRecord {
    if (typeof value !== 'object' || value === null) {
        throw new FilesApiError('generic', failureMessage);
    }
    const payload = value as Record<string, unknown>;
    if (!hasOnlyKeys(payload, ['file']) || !isBaseFileRecord(payload.file)) {
        throw new FilesApiError('generic', failureMessage);
    }
    return payload.file;
}

function parseDownloadUrl(value: unknown, fileName: string): string {
    if (typeof value !== 'object' || value === null) {
        throw new FilesApiError('generic', `Unable to download ${fileName}.`);
    }
    const payload = value as Record<string, unknown>;
    if (!hasOnlyKeys(payload, ['downloadUrl']) || !isNonEmptyString(payload.downloadUrl)) {
        throw new FilesApiError('generic', `Unable to download ${fileName}.`);
    }

    try {
        const url = new URL(payload.downloadUrl);
        if (url.protocol !== 'https:') throw new Error();
    } catch {
        throw new FilesApiError('generic', `Unable to download ${fileName}.`);
    }
    return payload.downloadUrl;
}

function parseInitiatedUpload(value: unknown): InitiatedUpload {
    if (typeof value !== 'object' || value === null) {
        throw new FilesApiError('generic', 'Unable to start the upload.');
    }
    const payload = value as Record<string, unknown>;
    if (
        !hasOnlyKeys(payload, ['fileId', 'uploadUrl']) ||
        !isNonEmptyString(payload.fileId) ||
        !isNonEmptyString(payload.uploadUrl)
    ) {
        throw new FilesApiError('generic', 'Unable to start the upload.');
    }

    try {
        const url = new URL(payload.uploadUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    } catch {
        throw new FilesApiError('generic', 'Unable to start the upload.');
    }
    return { fileId: payload.fileId, uploadUrl: payload.uploadUrl };
}

export async function listFiles(getToken: GetToken, signal: AbortSignal): Promise<FileRecord[]> {
    const response = await authenticatedRequest(
        getToken,
        '/api/files',
        { method: 'GET' },
        signal,
        'Unable to load files.',
        createFilesApiError
    );
    return parseFilesPayload(
        await responseJson(response, 'Unable to load files.', createFilesApiError)
    );
}

export async function getDownloadUrl(
    getToken: GetToken,
    fileId: string,
    fileName: string,
    signal: AbortSignal
): Promise<string> {
    const failureMessage = `Unable to download ${fileName}.`;
    const response = await authenticatedRequest(
        getToken,
        `/api/files/${encodeURIComponent(fileId)}/download`,
        { method: 'GET' },
        signal,
        failureMessage,
        createFilesApiError
    );
    return parseDownloadUrl(
        await responseJson(response, failureMessage, createFilesApiError),
        fileName
    );
}

export async function initiateUpload(
    getToken: GetToken,
    file: File,
    signal: AbortSignal
): Promise<InitiatedUpload> {
    const mimeType = file.type.trim() || DEFAULT_UPLOAD_MIME_TYPE;
    const response = await authenticatedRequest(
        getToken,
        '/api/files/uploads',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, mimeType, sizeBytes: file.size }),
        },
        signal,
        `Unable to upload ${file.name}.`,
        createFilesApiError
    );
    return parseInitiatedUpload(
        await responseJson(response, `Unable to upload ${file.name}.`, createFilesApiError)
    );
}

export async function putUpload(uploadUrl: string, file: File, signal: AbortSignal): Promise<void> {
    const mimeType = file.type.trim() || DEFAULT_UPLOAD_MIME_TYPE;
    let response: Response;
    try {
        response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: file,
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new FilesApiError('retryable', `Unable to upload ${file.name}.`);
    }
    if (!response.ok) throw new FilesApiError('generic', `Unable to upload ${file.name}.`);
}

export async function completeUpload(
    getToken: GetToken,
    fileId: string,
    signal: AbortSignal
): Promise<FileRecord> {
    const response = await authenticatedRequest(
        getToken,
        `/api/files/${encodeURIComponent(fileId)}/complete`,
        { method: 'POST' },
        signal,
        'The uploaded file could not be verified.',
        createFilesApiError
    );
    const failureMessage = 'The uploaded file could not be verified.';
    const file = parseFilePayload(
        await responseJson(response, failureMessage, createFilesApiError),
        failureMessage
    );
    return { ...file, isShared: false };
}

export async function deleteFile(
    getToken: GetToken,
    fileId: string,
    signal: AbortSignal
): Promise<void> {
    await authenticatedRequest(
        getToken,
        `/api/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE' },
        signal,
        'Unable to delete this file. Please try again.',
        createFilesApiError
    );
}

export async function renameFile(
    getToken: GetToken,
    fileId: string,
    name: string,
    signal: AbortSignal
): Promise<BaseFileRecord> {
    const failureMessage = 'Unable to rename this file. Please try again.';
    const response = await authenticatedRequest(
        getToken,
        `/api/files/${encodeURIComponent(fileId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        },
        signal,
        failureMessage,
        createFilesApiError
    );
    const file = parseFilePayload(
        await responseJson(response, failureMessage, createFilesApiError),
        failureMessage
    );
    if (file.fileId !== fileId || file.name !== name.trim()) {
        throw new FilesApiError('generic', failureMessage);
    }
    return file;
}
