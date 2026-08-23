export type BackendSessionFailureKind = 'authentication' | 'retryable' | 'generic';

export type BackendSessionResult =
    | { ok: true }
    | { ok: false; kind: BackendSessionFailureKind }
    | { ok: false; kind: 'aborted' };

type GetToken = () => Promise<string | null>;

function isVerifiedSessionPayload(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;

    const payload = value as Record<string, unknown>;
    return (
        payload.authenticated === true &&
        typeof payload.userId === 'string' &&
        payload.userId.trim().length > 0
    );
}

export async function verifyBackendSession(
    getToken: GetToken,
    signal: AbortSignal
): Promise<BackendSessionResult> {
    let token: string | null;

    try {
        token = await getToken();
    } catch {
        return signal.aborted ? { ok: false, kind: 'aborted' } : { ok: false, kind: 'generic' };
    }

    if (signal.aborted) return { ok: false, kind: 'aborted' };
    if (!token) return { ok: false, kind: 'authentication' };

    let response: Response;

    try {
        response = await fetch('/api/session', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal,
        });
    } catch {
        return signal.aborted ? { ok: false, kind: 'aborted' } : { ok: false, kind: 'retryable' };
    }

    if (response.status === 401 || response.status === 403) {
        return { ok: false, kind: 'authentication' };
    }

    if (response.status >= 500) return { ok: false, kind: 'retryable' };
    if (!response.ok) return { ok: false, kind: 'generic' };

    try {
        const payload: unknown = await response.json();
        return isVerifiedSessionPayload(payload) ? { ok: true } : { ok: false, kind: 'generic' };
    } catch {
        return { ok: false, kind: 'generic' };
    }
}
