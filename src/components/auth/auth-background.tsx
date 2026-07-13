import type { ReactNode } from 'react';

interface AuthBackgroundProps {
    children: ReactNode;
}

export function AuthBackground({ children }: AuthBackgroundProps) {
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
            {children}
        </main>
    );
}
