import { useAuth, useClerk } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import type { PreparedDownload } from '@/components/dashboard/download-files-dialog';
import {
    FileList,
    type DeleteBatchResult,
    type DownloadBatchResult,
} from '@/components/dashboard/file-list';
import { FileListSkeleton } from '@/components/dashboard/file-list-skeleton';
import { Button } from '@/components/ui/button';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@/components/ui/empty';
import {
    completeUpload,
    deleteFile,
    FilesApiError,
    getDownloadUrl,
    initiateUpload,
    listFiles,
    putUpload,
    renameFile,
} from '@/lib/files-api';
import type { FileRecord } from '@/lib/files';
import { UploadProvider, type UploadBatchResult } from '@/providers/upload-provider';

export const Route = createFileRoute('/_authenticated/dashboard')({
    component: DashboardPage,
});

function DashboardPage() {
    const { getToken, sessionId, userId } = useAuth();
    const { signOut } = useClerk();
    const queryClient = useQueryClient();
    const filesQueryKey = ['files', userId, sessionId] as const;
    const filesQuery = useQuery({
        queryKey: filesQueryKey,
        queryFn: ({ signal }) => listFiles(getToken, signal),
        enabled: Boolean(userId && sessionId),
        retry: (failureCount, error) =>
            error instanceof FilesApiError && error.kind === 'retryable' && failureCount < 2,
    });

    const isAuthenticationFailure =
        filesQuery.error instanceof FilesApiError && filesQuery.error.kind === 'authentication';

    async function downloadFiles(files: FileRecord[]): Promise<DownloadBatchResult> {
        const controller = new AbortController();
        const downloads: PreparedDownload[] = [];

        for (const file of files) {
            try {
                const downloadUrl = await getDownloadUrl(
                    getToken,
                    file.fileId,
                    file.name,
                    controller.signal
                );
                downloads.push({ fileId: file.fileId, fileName: file.name, downloadUrl });
            } catch {
                // Continue so one failed URL does not prevent preparing the remaining downloads.
            }
        }

        return { downloads, failed: files.length - downloads.length };
    }

    async function deleteFiles(files: FileRecord[]): Promise<DeleteBatchResult> {
        const deletedFileIds: string[] = [];
        const failedFileIds: string[] = [];
        let errorMessage: string | undefined;

        // Keep deletion sequential so selecting many rows cannot fan out unbounded requests.
        for (const file of files) {
            const controller = new AbortController();
            try {
                await deleteFile(getToken, file.fileId, controller.signal);
                deletedFileIds.push(file.fileId);
            } catch (error) {
                failedFileIds.push(file.fileId);
                errorMessage =
                    error instanceof FilesApiError
                        ? error.message
                        : 'Unable to delete the selected files. Please try again.';
            }
        }

        if (deletedFileIds.length > 0) {
            await queryClient.invalidateQueries({ queryKey: filesQueryKey });
        }
        return { deletedFileIds, failedFileIds, error: errorMessage };
    }

    async function renameSelectedFile(file: FileRecord, name: string): Promise<void> {
        const controller = new AbortController();
        const renamedFile = await renameFile(getToken, file.fileId, name, controller.signal);
        await queryClient.cancelQueries({ queryKey: filesQueryKey });
        queryClient.setQueryData<FileRecord[]>(filesQueryKey, (currentFiles) =>
            currentFiles?.map((currentFile) =>
                currentFile.fileId === renamedFile.fileId ? renamedFile : currentFile
            )
        );
    }

    async function uploadFiles(files: File[]): Promise<UploadBatchResult> {
        const uploadedFiles: File[] = [];
        let errorMessage: string | undefined;

        for (const file of files) {
            const controller = new AbortController();
            try {
                const upload = await initiateUpload(getToken, file, controller.signal);
                await putUpload(upload.uploadUrl, file, controller.signal);
                await completeUpload(getToken, upload.fileId, controller.signal);
                uploadedFiles.push(file);
            } catch (error) {
                errorMessage =
                    error instanceof FilesApiError
                        ? error.message
                        : `Unable to upload ${file.name}.`;
                if (error instanceof FilesApiError && error.kind === 'authentication') break;
            }
        }

        if (uploadedFiles.length) {
            await queryClient.invalidateQueries({ queryKey: filesQueryKey });
        }
        return { uploadedFiles, error: errorMessage };
    }

    return (
        <UploadProvider onUpload={uploadFiles}>
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
                    <FileList
                        files={filesQuery.data}
                        onDelete={deleteFiles}
                        onDownload={downloadFiles}
                        onRename={renameSelectedFile}
                    />
                )}
            </DashboardShell>
        </UploadProvider>
    );
}
