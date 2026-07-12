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

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type FileRecord = {
    id: string;
    name: string;
    mimeType: string;
    createdAt: string;
    modifiedAt: string;
    sizeBytes: number;
};

declare module '@tanstack/react-table' {
    // Column metadata keeps responsive widths beside the column definition.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData extends RowData, TValue> {
        className?: string;
    }
}

const nameCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

function compareNames(left: FileRecord, right: FileRecord) {
    return nameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id);
}

const sortByName: SortingFn<FileRecord> = (left, right) =>
    compareNames(left.original, right.original);

const sortByModified: SortingFn<FileRecord> = (left, right) => {
    const difference = Date.parse(left.original.modifiedAt) - Date.parse(right.original.modifiedAt);

    return difference || compareNames(left.original, right.original);
};

const sortBySize: SortingFn<FileRecord> = (left, right) =>
    left.original.sizeBytes - right.original.sizeBytes ||
    compareNames(left.original, right.original);

function formatDate(value: string) {
    const date = new Date(value);

    return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()]
        .map((part, index) => (index < 2 ? String(part).padStart(2, '0') : String(part)))
        .join('-');
}

function formatFileSize(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const displayValue = unitIndex === 0 ? String(value) : Number(value.toFixed(1)).toString();
    return `${displayValue} ${units[unitIndex]}`;
}

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
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant='link'
                                    size='sm'
                                    className='min-w-0 flex-1 shrink justify-start overflow-hidden px-0 text-white'
                                />
                            }
                        >
                            <span className='truncate'>{file.name}</span>
                        </TooltipTrigger>
                        <TooltipContent>{file.name}</TooltipContent>
                    </Tooltip>
                </div>
            );
        },
    },
    {
        id: 'modifiedAt',
        accessorKey: 'modifiedAt',
        sortingFn: sortByModified,
        sortDescFirst: true,
        meta: { className: 'w-[130px]' },
        header: ({ column }) => renderSortHeader(column, 'Modified'),
        cell: ({ getValue }) => formatDate(getValue<string>()),
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
];
