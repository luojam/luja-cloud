import { useAuth } from '@clerk/react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export const Route = createFileRoute('/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    if (!isSignedIn) return <Navigate to='/sign-in' replace />;

    return <DashboardShell>List</DashboardShell>;
}
