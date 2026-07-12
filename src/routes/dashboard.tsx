import { useAuth } from '@clerk/react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { FileList } from '@/components/dashboard/file-list';
import type { FileRecord } from '@/components/dashboard/file-table-columns';
import files from '@/data/files.json';

export const Route = createFileRoute('/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    if (!isSignedIn) return <Navigate to='/sign-in' replace />;

    return (
        <DashboardShell>
            <FileList files={files satisfies FileRecord[]} />
        </DashboardShell>
    );
}
