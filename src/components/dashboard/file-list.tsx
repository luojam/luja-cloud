import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import type { SortingState } from '@tanstack/react-table';
import { useState } from 'react';

import { fileTableColumns, type FileRecord } from '@/components/dashboard/file-table-columns';
import { useUpload } from '@/components/dashboard/upload-context';
import { Button } from '@/components/ui/button';
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
    // TanStack exposes mutable table APIs, so the React compiler safely skips this hook.
    // eslint-disable-next-line react-hooks/incompatible-library
    const table = useReactTable({
        data: files,
        columns: fileTableColumns,
        state: { sorting },
        onSortingChange: setSorting,
        getRowId: (file) => file.id,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });
    const fileLabel = files.length === 1 ? 'file' : 'files';

    return (
        <section className='flex w-full min-w-0 flex-col gap-3' aria-labelledby='files-heading'>
            <div className='flex items-baseline gap-2'>
                <h2 id='files-heading' className='text-sm font-semibold'>
                    Files
                </h2>
                <span className='text-muted-foreground text-xs'>
                    · {files.length} {fileLabel}
                </span>
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
                                <TableRow key={row.id} className='h-9'>
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
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </section>
    );
}
