import { useAuth, useClerk } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { FileList } from '@/components/dashboard/file-list';
import { FileListSkeleton } from '@/components/dashboard/file-list-skeleton';
import { Button } from '@/components/ui/button';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@/components/ui/empty';
import { FilesApiError, listFiles } from '@/lib/files-api';
import { UploadProvider } from '@/providers/upload-provider';

export const Route = createFileRoute('/_authenticated/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    const { getToken, sessionId, userId } = useAuth();
    const { signOut } = useClerk();
    const filesQuery = useQuery({
        queryKey: ['files', userId, sessionId],
        queryFn: ({ signal }) => listFiles(getToken, signal),
        enabled: Boolean(userId && sessionId),
        retry: (failureCount, error) =>
            error instanceof FilesApiError && error.kind === 'retryable' && failureCount < 2,
    });

    const isAuthenticationFailure =
        filesQuery.error instanceof FilesApiError && filesQuery.error.kind === 'authentication';

    return (
        <UploadProvider>
            <DashboardShell>
                {filesQuery.isPending ? (
                    <FileListSkeleton />
                ) : filesQuery.isError ? (
                    <Empty className='min-h-60 border'>
                        <EmptyHeader>
                            <EmptyTitle>
                                {isAuthenticationFailure
                                    ? 'Authentication failed'
                                    : 'Unable to load files'}
                            </EmptyTitle>
                            <EmptyDescription>
                                {isAuthenticationFailure
                                    ? 'Your current sign-in could not be accepted. Sign out and try again.'
                                    : 'Your files could not be loaded. Please try again.'}
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            {isAuthenticationFailure ? (
                                <Button type='button' onClick={() => void signOut()}>
                                    Sign out
                                </Button>
                            ) : (
                                <Button type='button' onClick={() => void filesQuery.refetch()}>
                                    Retry
                                </Button>
                            )}
                        </EmptyContent>
                    </Empty>
                ) : (
                    <FileList files={filesQuery.data} />
                )}
            </DashboardShell>
        </UploadProvider>
    );
}
