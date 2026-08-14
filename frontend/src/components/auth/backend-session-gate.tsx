import { useAuth, useClerk } from '@clerk/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AuthBackground } from '@/components/auth/auth-background';
import { AuthLoadingScreen } from '@/components/auth/auth-loading-screen';
import { Button } from '@/components/ui/button';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@/components/ui/empty';
import { type BackendSessionFailureKind, verifyBackendSession } from '@/lib/backend-session';

type BackendSessionGateProps = {
    children: ReactNode;
};

type VerificationState =
    | { status: 'pending'; sessionId: string | null }
    | { status: 'verified'; sessionId: string | null }
    | {
          status: 'failed';
          sessionId: string | null;
          kind: BackendSessionFailureKind;
      };

function FailureScreen({
    kind,
    onRetry,
    onSignOut,
}: {
    kind: BackendSessionFailureKind;
    onRetry: () => void;
    onSignOut: () => void;
}) {
    const isAuthenticationFailure = kind === 'authentication';

    return (
        <AuthBackground>
            <main className='flex min-h-svh items-center justify-center p-6'>
                <Empty className='max-w-lg border'>
                    <EmptyHeader>
                        <EmptyTitle>
                            {isAuthenticationFailure
                                ? 'Authentication failed'
                                : 'Unable to verify your session'}
                        </EmptyTitle>
                        <EmptyDescription>
                            {isAuthenticationFailure
                                ? 'Your current sign-in could not be accepted. Sign out and try again.'
                                : 'We could not confirm your session with the service. Please try again.'}
                        </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        {isAuthenticationFailure ? (
                            <Button type='button' onClick={onSignOut}>
                                Sign out
                            </Button>
                        ) : (
                            <Button type='button' onClick={onRetry}>
                                Retry
                            </Button>
                        )}
                    </EmptyContent>
                </Empty>
            </main>
        </AuthBackground>
    );
}

export function BackendSessionGate({ children }: BackendSessionGateProps) {
    const { getToken, isLoaded, isSignedIn, sessionId } = useAuth();
    const { signOut } = useClerk();
    const getTokenRef = useRef(getToken);
    const [retryAttempt, setRetryAttempt] = useState(0);
    const [state, setState] = useState<VerificationState>({
        status: 'pending',
        sessionId: null,
    });

    useEffect(() => {
        getTokenRef.current = getToken;
    }, [getToken]);

    useEffect(() => {
        if (!isLoaded || !isSignedIn) return;

        const activeSessionId = sessionId ?? null;
        const controller = new AbortController();
        let active = true;

        void verifyBackendSession(() => getTokenRef.current(), controller.signal).then((result) => {
            if (!active || (!result.ok && result.kind === 'aborted')) return;

            setState(
                result.ok
                    ? { status: 'verified', sessionId: activeSessionId }
                    : {
                          status: 'failed',
                          sessionId: activeSessionId,
                          kind: result.kind,
                      }
            );
        });

        return () => {
            active = false;
            controller.abort();
        };
    }, [isLoaded, isSignedIn, retryAttempt, sessionId]);

    if (!isLoaded || !isSignedIn) return <AuthLoadingScreen />;

    const activeSessionId = sessionId ?? null;
    if (state.sessionId !== activeSessionId || state.status === 'pending') {
        return <AuthLoadingScreen />;
    }

    if (state.status === 'failed') {
        return (
            <FailureScreen
                kind={state.kind}
                onRetry={() => {
                    setState({ status: 'pending', sessionId: activeSessionId });
                    setRetryAttempt((attempt) => attempt + 1);
                }}
                onSignOut={() => void signOut()}
            />
        );
    }

    return children;
}
