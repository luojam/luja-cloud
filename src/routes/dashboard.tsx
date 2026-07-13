import { useAuth } from '@clerk/react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { FileList } from '@/components/dashboard/file-list';
import files from '@/data/files.json';
import type { FileRecord } from '@/lib/files';
import { UploadProvider } from '@/providers/upload-provider';

export const Route = createFileRoute('/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    if (!isSignedIn) return <Navigate to='/sign-in' replace />;

    return (
        <UploadProvider>
            <DashboardShell>
                <FileList files={files satisfies FileRecord[]} />
            </DashboardShell>
        </UploadProvider>
    );
}
