import { Skeleton } from '@/components/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const fileTableColumnClassNames = {
    select: 'w-10',
    name: 'min-w-0',
    modifiedAt: 'w-[130px]',
    sizeBytes: 'hidden w-[90px] text-right sm:table-cell',
    actions: 'w-10 text-right',
} as const;

const nameWidths = ['w-2/5', 'w-3/5', 'w-1/2', 'w-4/5'] as const;

type FileListSkeletonProps = {
    rowCount?: number;
};

export function FileListSkeleton({ rowCount = 7 }: FileListSkeletonProps) {
    return (
        <section
            className='flex w-full min-w-0 flex-col gap-3'
            aria-busy='true'
            aria-describedby='files-loading-status'
            aria-labelledby='files-loading-heading'
        >
            <span id='files-loading-status' className='sr-only' role='status'>
                Loading files
            </span>

            <div className='flex items-center justify-between gap-3'>
                <div className='flex items-baseline gap-2'>
                    <h2 id='files-loading-heading' className='text-sm font-semibold'>
                        Files
                    </h2>
                    <Skeleton className='h-3 w-14' aria-hidden='true' />
                </div>
                <div className='flex items-center gap-2' aria-hidden='true'>
                    <Skeleton className='h-8 w-24' />
                    <Skeleton className='h-8 w-20' />
                </div>
            </div>

            {/* The table geometry matches FileList to avoid a layout jump. */}
            <div className='overflow-hidden rounded-lg border' aria-hidden='true'>
                <Table className='table-fixed'>
                    <TableHeader className='bg-muted/50'>
                        <TableRow className='hover:bg-transparent'>
                            <TableHead className={fileTableColumnClassNames.select}>
                                <Skeleton className='size-4' />
                            </TableHead>
                            <TableHead className={fileTableColumnClassNames.name}>
                                <Skeleton className='h-4 w-14' />
                            </TableHead>
                            <TableHead className={fileTableColumnClassNames.modifiedAt}>
                                <Skeleton className='h-4 w-16' />
                            </TableHead>
                            <TableHead className={fileTableColumnClassNames.sizeBytes}>
                                <Skeleton className='ml-auto h-4 w-8' />
                            </TableHead>
                            <TableHead className={fileTableColumnClassNames.actions}>
                                <span className='sr-only'>Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: rowCount }, (_, index) => (
                            <TableRow key={index} className='h-9 hover:bg-transparent'>
                                <TableCell
                                    className={cn(fileTableColumnClassNames.select, 'h-9 py-0')}
                                >
                                    <Skeleton className='size-4' />
                                </TableCell>
                                <TableCell
                                    className={cn(fileTableColumnClassNames.name, 'h-9 py-0')}
                                >
                                    <div className='flex min-w-0 items-center gap-2'>
                                        <Skeleton className='size-4 shrink-0' />
                                        <Skeleton
                                            className={cn(
                                                'h-4',
                                                nameWidths[index % nameWidths.length]
                                            )}
                                        />
                                    </div>
                                </TableCell>
                                <TableCell
                                    className={cn(fileTableColumnClassNames.modifiedAt, 'h-9 py-0')}
                                >
                                    <Skeleton className='h-4 w-20' />
                                </TableCell>
                                <TableCell
                                    className={cn(fileTableColumnClassNames.sizeBytes, 'h-9 py-0')}
                                >
                                    <Skeleton className='ml-auto h-4 w-12' />
                                </TableCell>
                                <TableCell
                                    className={cn(fileTableColumnClassNames.actions, 'h-9 py-0')}
                                >
                                    <Skeleton className='ml-auto size-6' />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </section>
    );
}
