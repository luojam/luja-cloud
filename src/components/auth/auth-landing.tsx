import { SignIn, useAuth } from '@clerk/react';
import { Navigate } from '@tanstack/react-router';

function ClerkPanel() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return <div className='w-full max-w-[25rem]' />;
    if (isSignedIn) return <Navigate to='/dashboard' replace />;

    return (
        <div className='w-full max-w-[25rem]'>
            <SignIn
                withSignUp
                routing='hash'
                forceRedirectUrl='/dashboard'
                signUpForceRedirectUrl='/dashboard'
                appearance={{
                    variables: {
                        colorPrimary: 'oklch(0.455 0.188 13.697)',
                    },
                }}
            />
        </div>
    );
}

export function AuthLanding() {
    return (
        <main className='dark bg-background text-foreground relative min-h-svh overflow-hidden'>
            <div
                className='absolute -top-72 -right-40 size-192 rounded-full bg-[radial-gradient(circle_at_35%_40%,rgba(251,113,133,0.14),rgba(244,63,94,0.02)_58%,transparent_74%)] blur-3xl'
                aria-hidden='true'
            />
            <div
                className='absolute -bottom-88 -left-60 size-200 rounded-full bg-[radial-gradient(circle_at_center,rgba(196,181,253,0.12),rgba(219,39,119,0.015)_62%,transparent_76%)] blur-3xl'
                aria-hidden='true'
            />
            <section className='relative z-1 mx-auto grid min-h-[calc(100svh-4.5rem)] w-[calc(100%-2.5rem)] max-w-6xl grid-cols-[minmax(0,1fr)_minmax(21rem,28rem)] items-center gap-[clamp(3rem,9vw,10rem)] pt-16 pb-24 max-[800px]:grid-cols-1 max-[800px]:pt-12'>
                <div>
                    <h1 className='mb-6 max-w-[40rem] text-[clamp(2.6rem,5vw,5rem)] leading-[1.02] font-[560] tracking-[-0.055em]'>
                        luja Cloud
                    </h1>
                    <p className='max-w-[31rem] text-[clamp(0.9rem,1.4vw,1.05rem)] leading-[1.75] text-current/62'>
                        plain useful
                    </p>
                </div>
                <ClerkPanel />
            </section>
        </main>
    );
}
