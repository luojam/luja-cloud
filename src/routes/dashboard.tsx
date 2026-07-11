import { UserButton, useAuth } from '@clerk/react';
import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    if (!isSignedIn) return <Navigate to='/sign-in' replace />;

    return (
        <main className='flex min-h-svh items-start justify-between p-6'>
            <h1 className='text-lg font-semibold'>Dashboard</h1>
            <UserButton />
        </main>
    );
}
