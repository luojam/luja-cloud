import { Delete02Icon, Download04Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import type { RowSelectionState, SortingState } from '@tanstack/react-table';
import { useRef, useState } from 'react';

import { DeleteFilesDialog } from '@/components/dashboard/delete-files-dialog';
import {
    DownloadFilesDialog,
    type PreparedDownload,
} from '@/components/dashboard/download-files-dialog';
import { FileActionsContextMenu } from '@/components/dashboard/file-actions';
import { fileTableColumns } from '@/components/dashboard/file-table-columns';
import { RenameFileDialog } from '@/components/dashboard/rename-file-dialog';
import { useUpload } from '@/contexts/upload-context';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { FileRecord } from '@/lib/files';
import { cn } from '@/lib/utils';

export type DownloadBatchResult = {
    downloads: PreparedDownload[];
    failed: number;
};

type FileListProps = {
    files: FileRecord[];
    onDelete?: (files: FileRecord[]) => void;
    onDownload?: (files: FileRecord[]) => Promise<DownloadBatchResult>;
    onRename?: (file: FileRecord, fileName: string) => Promise<void>;
};

function getAriaSort(direction: false | 'asc' | 'desc') {
    if (direction === 'asc') return 'ascending';
    if (direction === 'desc') return 'descending';
    return 'none';
}

export function FileList({ files, onDelete, onDownload, onRename }: FileListProps) {
    const { selectFiles } = useUpload();
    const [sorting, setSorting] = useState<SortingState>([{ id: 'modifiedAt', desc: true }]);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [filesToDelete, setFilesToDelete] = useState<FileRecord[]>([]);
    const [fileToRename, setFileToRename] = useState<FileRecord | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadStatus, setDownloadStatus] = useState('');
    const [preparedDownloads, setPreparedDownloads] = useState<PreparedDownload[]>([]);
    const downloadInProgress = useRef(false);
    // TanStack exposes mutable table APIs, so the React compiler safely skips this hook.
    // eslint-disable-next-line react-hooks/incompatible-library
    const table = useReactTable({
        data: files,
        columns: fileTableColumns,
        state: { sorting, rowSelection },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        enableRowSelection: true,
        getRowId: (file) => file.fileId,
        meta: {
            isDownloading,
            onDelete: setFilesToDelete,
            onDownload: (selectedFiles) => void downloadFiles(selectedFiles),
            onRename: setFileToRename,
        },
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });
    const fileLabel = files.length === 1 ? 'file' : 'files';
    const selectedFiles = table.getSelectedRowModel().rows.map((row) => row.original);
    const selectedCount = selectedFiles.length;

    async function downloadFiles(selectedFiles: FileRecord[]) {
        if (downloadInProgress.current || !onDownload || selectedFiles.length === 0) return;

        downloadInProgress.current = true;
        setIsDownloading(true);
        setDownloadStatus(
            `Preparing ${selectedFiles.length} ${selectedFiles.length === 1 ? 'download' : 'downloads'}…`
        );
        try {
            const result = await onDownload(selectedFiles);
            const succeeded = result.downloads.length;

            if (selectedFiles.length === 1 && succeeded === 1) {
                const anchor = document.createElement('a');
                anchor.href = result.downloads[0].downloadUrl;
                document.body.append(anchor);
                try {
                    anchor.click();
                } finally {
                    anchor.remove();
                }
                setDownloadStatus('Download requested.');
            } else if (succeeded > 0) {
                setPreparedDownloads(result.downloads);
                setDownloadStatus(
                    result.failed === 0
                        ? `${succeeded} ${succeeded === 1 ? 'download is' : 'downloads are'} ready.`
                        : `${succeeded} ${succeeded === 1 ? 'download is' : 'downloads are'} ready; ${result.failed} ${result.failed === 1 ? 'file' : 'files'} could not be prepared.`
                );
            } else {
                setDownloadStatus(
                    `Unable to prepare ${result.failed} ${result.failed === 1 ? 'download' : 'downloads'}.`
                );
            }
        } catch {
            setDownloadStatus('Unable to prepare the download. Please try again.');
        } finally {
            downloadInProgress.current = false;
            setIsDownloading(false);
        }
    }

    function confirmDelete() {
        onDelete?.(filesToDelete);
        setFilesToDelete([]);
        table.resetRowSelection();
    }

    async function confirmRename(fileName: string) {
        if (!fileToRename || !onRename) return;
        await onRename(fileToRename, fileName);
        setFileToRename(null);
    }

    return (
        <section className='flex w-full min-w-0 flex-col gap-3' aria-labelledby='files-heading'>
            <div className='flex items-center justify-between gap-3'>
                <div className='flex items-baseline gap-2'>
                    <h2 id='files-heading' className='text-sm font-semibold'>
                        Files
                    </h2>
                    <span className='text-muted-foreground text-xs' aria-live='polite'>
                        · {files.length} {fileLabel}
                        {selectedCount > 0 && ` · ${selectedCount} selected`}
                    </span>
                </div>
                <div className='flex items-center gap-2'>
                    <Button
                        variant='outline'
                        size='sm'
                        disabled={selectedCount === 0 || isDownloading || !onDownload}
                        onClick={() => void downloadFiles(selectedFiles)}
                    >
                        {isDownloading ? (
                            <Spinner data-icon='inline-start' />
                        ) : (
                            <HugeiconsIcon
                                icon={Download04Icon}
                                data-icon='inline-start'
                                strokeWidth={1.8}
                            />
                        )}
                        {isDownloading ? 'Preparing…' : 'Download'}
                    </Button>
                    <Button
                        variant='destructive'
                        size='sm'
                        disabled={selectedCount === 0}
                        onClick={() => setFilesToDelete(selectedFiles)}
                    >
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                        Delete
                    </Button>
                </div>
            </div>
            {downloadStatus && (
                <p className='text-muted-foreground text-xs' aria-live='polite'>
                    {downloadStatus}
                </p>
            )}

            {files.length === 0 ? (
                <Empty className='min-h-60 rounded-lg border border-solid'>
                    <EmptyHeader>
                        <EmptyTitle>No files yet</EmptyTitle>
                    </EmptyHeader>
                    <EmptyContent>
                        <Button type='button' onClick={selectFiles}>
                            Upload
                        </Button>
                    </EmptyContent>
                </Empty>
            ) : (
                <div className='overflow-hidden rounded-lg border'>
                    <Table className='table-fixed'>
                        <TableHeader className='bg-muted/50'>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id} className='hover:bg-transparent'>
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            className={header.column.columnDef.meta?.className}
                                            aria-sort={getAriaSort(header.column.getIsSorted())}
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef.header,
                                                      header.getContext()
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <ContextMenu
                                    key={row.id}
                                    onOpenChange={(open) => {
                                        if (open) table.resetRowSelection();
                                    }}
                                >
                                    <ContextMenuTrigger
                                        render={
                                            <TableRow
                                                className='data-popup-open:bg-muted h-9'
                                                data-state={
                                                    row.getIsSelected() ? 'selected' : undefined
                                                }
                                            />
                                        }
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <TableCell
                                                key={cell.id}
                                                className={cn(
                                                    'h-9 py-0',
                                                    cell.column.columnDef.meta?.className
                                                )}
                                            >
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext()
                                                )}
                                            </TableCell>
                                        ))}
                                    </ContextMenuTrigger>
                                    <FileActionsContextMenu
                                        isDownloading={isDownloading}
                                        onDelete={() => setFilesToDelete([row.original])}
                                        onDownload={() => void downloadFiles([row.original])}
                                        onRename={() => setFileToRename(row.original)}
                                    />
                                </ContextMenu>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <DownloadFilesDialog
                downloads={preparedDownloads}
                onOpenChange={(open) => {
                    if (!open) setPreparedDownloads([]);
                }}
            />
            <DeleteFilesDialog
                fileNames={filesToDelete.map((file) => file.name)}
                onOpenChange={(open) => {
                    if (!open) setFilesToDelete([]);
                }}
                onConfirm={confirmDelete}
            />
            {fileToRename && (
                <RenameFileDialog
                    // Reset the draft when a different file is selected.
                    key={fileToRename.fileId}
                    fileName={fileToRename.name}
                    onOpenChange={(open) => {
                        if (!open) setFileToRename(null);
                    }}
                    onConfirm={confirmRename}
                />
            )}
        </section>
    );
}
