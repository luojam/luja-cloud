import { SignIn, SignUp } from '@clerk/react';
import type { ComponentProps } from 'react';
import { AuthBackground } from '@/components/auth/auth-background';
import { BrandMark } from '@/components/auth/brand-mark';
import { Skeleton } from '@/components/ui/skeleton';

type AuthMode = 'sign-in' | 'sign-up';

function ClerkPanelSkeleton({ mode }: { mode: AuthMode }) {
    const formName = mode === 'sign-in' ? 'sign-in' : 'sign-up';

    return (
        <div
            className='bg-card flex w-full flex-col gap-7 rounded-xl border p-6 sm:p-8'
            role='status'
            aria-label={`Loading ${formName} form`}
        >
            {/* Follow Clerk's compact form rhythm without guessing a fixed panel height. */}
            <Skeleton className='h-7 w-32' />
            <Skeleton className='h-9 w-full' />
            <div className='flex items-center gap-3'>
                <Skeleton className='h-px flex-1' />
                <Skeleton className='h-4 w-8' />
                <Skeleton className='h-px flex-1' />
            </div>
            <div className='flex flex-col gap-3'>
                <Skeleton className='h-4 w-20' />
                <Skeleton className='h-9 w-full' />
            </div>
            <Skeleton className='h-9 w-full' />
            <div className='flex gap-2'>
                <Skeleton className='h-4 w-28' />
                <Skeleton className='h-4 w-14' />
            </div>
        </div>
    );
}

type ClerkAppearance = NonNullable<ComponentProps<typeof SignIn>['appearance']>;

const clerkAppearance = {
    options: {
        elevation: 'flush',
        logoPlacement: 'none',
    },
    variables: {
        colorPrimary: 'var(--primary)',
        colorPrimaryForeground: 'var(--primary-foreground)',
        colorForeground: 'var(--foreground)',
        colorMutedForeground: 'var(--muted-foreground)',
        colorBackground: 'transparent',
        colorInput: 'var(--input)',
        colorInputForeground: 'var(--foreground)',
        colorBorder: 'var(--border)',
        colorRing: 'var(--ring)',
        fontFamily: 'var(--font-sans)',
        fontSize: '0.875rem',
        borderRadius: 'var(--radius-md)',
        spacing: '0.875rem',
    },
    elements: {
        rootBox: 'w-full',
        cardBox: 'w-full',
        header: 'items-start text-left',
        headerTitle: 'text-xl font-medium tracking-[-0.025em]',
        headerSubtitle: 'hidden',
        socialButtonsBlockButton: {
            borderWidth: 0,
            boxShadow: 'none !important',
            '&:focus-visible': {
                outline: '2px solid var(--ring)',
                outlineOffset: '2px',
            },
        },
        dividerLine: 'bg-border',
        dividerText: 'text-muted-foreground',
        formFieldInput: 'shadow-xs',
        formButtonPrimary:
            'shadow-none transition-[background-color,transform] active:translate-y-px',
        footerAction: 'justify-start',
        footerActionText: 'text-muted-foreground',
    },
    captcha: {
        theme: 'dark',
    },
} satisfies ClerkAppearance;

function ClerkPanel({ mode }: { mode: AuthMode }) {
    return mode === 'sign-in' ? (
        <SignIn
            withSignUp={false}
            signUpUrl='/sign-up'
            routing='hash'
            forceRedirectUrl='/dashboard'
            fallback={<ClerkPanelSkeleton mode={mode} />}
            appearance={clerkAppearance}
        />
    ) : (
        <SignUp
            signInUrl='/sign-in'
            routing='hash'
            forceRedirectUrl='/dashboard'
            fallback={<ClerkPanelSkeleton mode={mode} />}
            appearance={clerkAppearance}
        />
    );
}

export function AuthLanding({ mode }: { mode: AuthMode }) {
    return (
        <AuthBackground>
            <section className='relative z-1 flex min-h-svh items-center justify-center px-5 py-10 sm:px-8 sm:py-14'>
                <div className='flex w-full max-w-[25rem] flex-col gap-8 sm:gap-10'>
                    <BrandMark />
                    <ClerkPanel mode={mode} />
                </div>
            </section>
        </AuthBackground>
    );
}
