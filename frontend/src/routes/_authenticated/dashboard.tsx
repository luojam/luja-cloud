import { createFileRoute } from '@tanstack/react-router';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { UploadProvider } from '@/providers/upload-provider';

export const Route = createFileRoute('/_authenticated/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    return (
        <UploadProvider>
            <DashboardShell>
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>Backend session verified</EmptyTitle>
                    </EmptyHeader>
                </Empty>
            </DashboardShell>
        </UploadProvider>
    );
}
