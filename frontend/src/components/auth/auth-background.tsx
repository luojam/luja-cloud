import type { ReactNode } from 'react';

interface AuthBackgroundProps {
    children: ReactNode;
}

export function AuthBackground({ children }: AuthBackgroundProps) {
    return (
        <main className='auth-background dark bg-background text-foreground relative min-h-svh overflow-hidden'>
            <div className='auth-scene' aria-hidden='true'>
                <div className='auth-scene__light auth-scene__light--ruby' />
                <div className='auth-scene__light auth-scene__light--violet' />
                <div className='auth-orbit'>
                    <span className='auth-orbit__ring auth-orbit__ring--outer' />
                    <span className='auth-orbit__ring auth-orbit__ring--inner' />
                    <span className='auth-orbit__marker auth-orbit__marker--one' />
                    <span className='auth-orbit__marker auth-orbit__marker--two' />
                    <span className='auth-orbit__marker auth-orbit__marker--three' />
                    <span className='auth-orbit__marker auth-orbit__marker--four' />
                    <span className='auth-orbit__marker auth-orbit__marker--five' />
                    <span className='auth-orbit__marker auth-orbit__marker--six' />
                    <span className='auth-orbit__marker auth-orbit__marker--seven' />
                </div>
            </div>
            {children}
        </main>
    );
}
