export type GetToken = () => Promise<string | null>;

export type AuthenticatedRequestFailureKind = 'authentication' | 'retryable' | 'generic';

type ErrorFactory = (kind: AuthenticatedRequestFailureKind, message: string) => Error;

type AuthenticatedRequestOptions = {
    expectedStatus?: number;
    getResponseError?: (response: Response) => Error | undefined;
};

export async function responseJson(
    response: Response,
    failureMessage: string,
    createError: ErrorFactory
): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        throw createError('generic', failureMessage);
    }
}

export async function authenticatedRequest(
    getToken: GetToken,
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    failureMessage: string,
    createError: ErrorFactory,
    options: AuthenticatedRequestOptions = {}
): Promise<Response> {
    let token: string | null;
    try {
        token = await getToken();
    } catch {
        if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        throw createError('generic', failureMessage);
    }

    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (!token) {
        throw createError('authentication', 'Your sign-in could not be verified.');
    }

    let response: Response;
    try {
        response = await fetch(path, {
            ...init,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                ...init.headers,
            },
            cache: 'no-store',
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw createError('retryable', failureMessage);
    }

    if (response.status === 401 || response.status === 403) {
        throw createError('authentication', 'Your sign-in could not be verified.');
    }

    const responseError = options.getResponseError?.(response);
    if (responseError) throw responseError;

    if (response.status >= 500) throw createError('retryable', failureMessage);

    const hasExpectedStatus =
        options.expectedStatus === undefined
            ? response.ok
            : response.status === options.expectedStatus;
    if (!hasExpectedStatus) throw createError('generic', failureMessage);

    return response;
}
