import {
    Archive02Icon,
    ArrowDown01Icon,
    ArrowUp01Icon,
    File01Icon,
    File02Icon,
    FileImageIcon,
    FileSpreadsheetIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import type { Column, ColumnDef, RowData, SortingFn } from '@tanstack/react-table';
import { FileActionsDropdown } from '@/components/dashboard/file-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    compareFilesByModified,
    compareFilesByName,
    compareFilesBySize,
    formatFileDate,
    formatFileSize,
    type FileRecord,
} from '@/lib/files';

declare module '@tanstack/react-table' {
    // Column metadata keeps responsive widths beside the column definition.
    interface ColumnMeta<TData extends RowData, TValue> {
        className?: string;
    }

    // Table metadata connects row actions to list-level dialogs.
    interface TableMeta<TData extends RowData> {
        isDownloading?: boolean;
        onDelete?: (files: TData[]) => void;
        onDownload?: (files: TData[]) => void;
        onRename?: (file: TData) => void;
        onShare?: (file: TData) => void;
    }
}

const sortByName: SortingFn<FileRecord> = (left, right) =>
    compareFilesByName(left.original, right.original);

const sortByModified: SortingFn<FileRecord> = (left, right) =>
    compareFilesByModified(left.original, right.original);

const sortBySize: SortingFn<FileRecord> = (left, right) =>
    compareFilesBySize(left.original, right.original);

function getFileIcon(mimeType: string): IconSvgElement {
    if (mimeType.startsWith('image/')) return FileImageIcon;
    if (mimeType === 'text/csv' || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
        return FileSpreadsheetIcon;
    }
    if (mimeType.includes('zip') || mimeType.includes('gzip') || mimeType.includes('archive')) {
        return Archive02Icon;
    }
    if (
        mimeType.startsWith('text/') ||
        mimeType === 'application/pdf' ||
        mimeType.includes('word')
    ) {
        return File02Icon;
    }
    return File01Icon;
}

function renderSortHeader(column: Column<FileRecord, unknown>, label: string) {
    const direction = column.getIsSorted();

    return (
        <Button
            variant='ghost'
            size='sm'
            className='-ml-2'
            onClick={column.getToggleSortingHandler()}
            title={`Sort by ${label}`}
        >
            {label}
            {direction && (
                <HugeiconsIcon
                    icon={direction === 'asc' ? ArrowUp01Icon : ArrowDown01Icon}
                    data-icon='inline-end'
                    strokeWidth={2}
                />
            )}
        </Button>
    );
}

export const fileTableColumns: ColumnDef<FileRecord>[] = [
    {
        id: 'select',
        enableSorting: false,
        meta: { className: 'w-10' },
        header: ({ table }) => (
            <Checkbox
                aria-label='Select all files'
                checked={table.getIsAllRowsSelected()}
                indeterminate={table.getIsSomeRowsSelected()}
                onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                aria-label={`Select ${row.original.name}`}
                checked={row.getIsSelected()}
                onCheckedChange={(checked) => row.toggleSelected(checked)}
            />
        ),
    },
    {
        id: 'name',
        accessorKey: 'name',
        sortingFn: sortByName,
        sortDescFirst: false,
        meta: { className: 'min-w-0' },
        header: ({ column }) => renderSortHeader(column, 'Name'),
        cell: ({ row }) => {
            const file = row.original;

            return (
                <div className='flex min-w-0 items-center gap-2'>
                    <HugeiconsIcon
                        className='text-muted-foreground size-4 shrink-0'
                        icon={getFileIcon(file.mimeType)}
                        strokeWidth={1.8}
                    />
                    <span className='min-w-0 flex-1 truncate text-white'>{file.name}</span>
                    {file.isShared && (
                        <Badge variant='secondary' className='hidden sm:inline-flex'>
                            Shared
                        </Badge>
                    )}
                </div>
            );
        },
    },
    {
        id: 'modifiedAt',
        accessorKey: 'modifiedAt',
        sortingFn: sortByModified,
        sortDescFirst: true,
        meta: { className: 'hidden w-[130px] sm:table-cell' },
        header: ({ column }) => renderSortHeader(column, 'Modified'),
        cell: ({ getValue }) => formatFileDate(getValue<string>()),
    },
    {
        id: 'sizeBytes',
        accessorKey: 'sizeBytes',
        sortingFn: sortBySize,
        sortDescFirst: true,
        meta: { className: 'hidden w-[90px] text-right sm:table-cell' },
        header: ({ column }) => renderSortHeader(column, 'Size'),
        cell: ({ getValue }) => formatFileSize(getValue<number>()),
    },
    {
        id: 'actions',
        enableSorting: false,
        meta: { className: 'w-10 text-right' },
        header: () => <span className='sr-only'>Actions</span>,
        cell: ({ row, table }) => (
            <FileActionsDropdown
                fileName={row.original.name}
                isDownloading={table.options.meta?.isDownloading ?? false}
                onDelete={() => table.options.meta?.onDelete?.([row.original])}
                onDownload={() => table.options.meta?.onDownload?.([row.original])}
                onOpen={() => table.resetRowSelection()}
                onRename={() => table.options.meta?.onRename?.(row.original)}
                onShare={() => table.options.meta?.onShare?.(row.original)}
            />
        ),
    },
];
