import { createHash, randomBytes } from 'node:crypto';

export const SHARE_TOKEN_BYTES = 32;

export function generateShareToken(): string {
    return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

export function hashShareToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}
