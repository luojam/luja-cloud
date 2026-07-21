import { SignIn } from '@clerk/react';
import { AuthBackground } from '@/components/auth/auth-background';
import { Skeleton } from '@/components/ui/skeleton';

function ClerkPanelSkeleton() {
    return (
        <div
            className='bg-card flex w-full flex-col gap-6 rounded-xl border p-8'
            role='status'
            aria-label='Loading sign-in form'
        >
            {/* Follow Clerk's compact form rhythm without guessing a fixed panel height. */}
            <div className='flex flex-col items-center gap-3'>
                <Skeleton className='h-8 w-36' />
                <Skeleton className='h-4 w-56' />
            </div>
            <Skeleton className='h-10 w-full' />
            <div className='flex items-center gap-3'>
                <Skeleton className='h-px flex-1' />
                <Skeleton className='h-4 w-8' />
                <Skeleton className='h-px flex-1' />
            </div>
            <div className='flex flex-col gap-3'>
                <Skeleton className='h-4 w-24' />
                <Skeleton className='h-10 w-full' />
            </div>
            <Skeleton className='h-10 w-full' />
            <div className='flex justify-center gap-2'>
                <Skeleton className='h-4 w-28' />
                <Skeleton className='h-4 w-16' />
            </div>
        </div>
    );
}

function ClerkPanel() {
    return (
        <div className='w-full max-w-[25rem]'>
            <SignIn
                withSignUp
                routing='hash'
                forceRedirectUrl='/dashboard'
                signUpForceRedirectUrl='/dashboard'
                fallback={<ClerkPanelSkeleton />}
                appearance={{
                    variables: {
                        colorPrimary: 'var(--primary)',
                    },
                }}
            />
        </div>
    );
}

export function AuthLanding() {
    return (
        <AuthBackground>
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
        </AuthBackground>
    );
}
