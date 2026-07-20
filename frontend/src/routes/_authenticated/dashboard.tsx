import { createFileRoute } from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { FileList } from '@/components/dashboard/file-list';
import files from '@/data/files.json';
import type { FileRecord } from '@/lib/files';
import { UploadProvider } from '@/providers/upload-provider';

export const Route = createFileRoute('/_authenticated/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    return (
        <UploadProvider>
            <DashboardShell>
                <FileList files={files satisfies FileRecord[]} />
            </DashboardShell>
        </UploadProvider>
    );
}
