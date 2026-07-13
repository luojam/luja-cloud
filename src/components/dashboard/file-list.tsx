import { Delete02Icon, Download04Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import type { RowSelectionState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';

import { FileActionsContextMenu } from '@/components/dashboard/file-actions';
import { fileTableColumns, type FileRecord } from '@/components/dashboard/file-table-columns';
import { useUpload } from '@/components/dashboard/upload-context';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type FileListProps = {
    files: FileRecord[];
};

function getAriaSort(direction: false | 'asc' | 'desc') {
    if (direction === 'asc') return 'ascending';
    if (direction === 'desc') return 'descending';
    return 'none';
}

export function FileList({ files }: FileListProps) {
    const { selectFiles } = useUpload();
    const [sorting, setSorting] = useState<SortingState>([{ id: 'modifiedAt', desc: true }]);
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    // TanStack exposes mutable table APIs, so the React compiler safely skips this hook.
    // eslint-disable-next-line react-hooks/incompatible-library
    const table = useReactTable({
        data: files,
        columns: fileTableColumns,
        state: { sorting, rowSelection },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        enableRowSelection: true,
        getRowId: (file) => file.id,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });
    const fileLabel = files.length === 1 ? 'file' : 'files';
    const selectedCount = table.getSelectedRowModel().rows.length;

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
                    <Button variant='outline' size='sm' disabled={selectedCount === 0}>
                        <HugeiconsIcon icon={Download04Icon} strokeWidth={1.8} />
                        Download
                    </Button>
                    <Button variant='destructive' size='sm' disabled={selectedCount === 0}>
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                        Delete
                    </Button>
                </div>
            </div>

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
                                    <FileActionsContextMenu />
                                </ContextMenu>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </section>
    );
}
