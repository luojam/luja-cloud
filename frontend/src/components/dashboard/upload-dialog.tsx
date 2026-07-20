import { Add01Icon, Delete02Icon, File01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type DragEvent, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatFileSize, getUploadFileFingerprint } from '@/lib/files';
import { cn } from '@/lib/utils';

type UploadDialogProps = {
    open: boolean;
    files: File[];
    isUploading: boolean;
    onOpenChange: (open: boolean) => void;
    onAddFiles: (files: File[]) => void;
    onRemoveFile: (file: File) => void;
    onSelectFiles: () => void;
    onUpload: () => void;
};

export function UploadDialog({
    open,
    files,
    isUploading,
    onOpenChange,
    onAddFiles,
    onRemoveFile,
    onSelectFiles,
    onUpload,
}: UploadDialogProps) {
    const dragDepthRef = useRef(0);
    const [isDragging, setIsDragging] = useState(false);
    const totalSize = files.reduce((total, file) => total + file.size, 0);

    function resetDragging() {
        dragDepthRef.current = 0;
        setIsDragging(false);
    }

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen) resetDragging();
        onOpenChange(nextOpen);
    }

    function handleDragEnter(event: DragEvent<HTMLDivElement>) {
        if (isUploading || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDragging(true);
    }

    function handleDragOver(event: DragEvent<HTMLDivElement>) {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = isUploading ? 'none' : 'copy';
    }

    function handleDragLeave(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragging(false);
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        resetDragging();
        if (!isUploading) onAddFiles(Array.from(event.dataTransfer.files));
    }

    const fileLabel = files.length === 1 ? 'file' : 'files';
    const fileItems = files.map((file) => (
        <div
            key={getUploadFileFingerprint(file)}
            className='bg-muted/50 flex w-full min-w-0 items-center gap-3 rounded-md p-2'
        >
            <HugeiconsIcon icon={File01Icon} className='shrink-0' strokeWidth={2} />
            <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>{file.name}</p>
                <p className='text-muted-foreground'>{formatFileSize(file.size)}</p>
            </div>
            <Button
                type='button'
                variant='ghost'
                size='icon-lg'
                aria-label={`Remove ${file.name}`}
                disabled={isUploading}
                onClick={() => onRemoveFile(file)}
            >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
        </div>
    ));

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={cn('sm:max-w-lg', isDragging && 'ring-primary ring-2')}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <DialogHeader>
                    <DialogTitle>Upload files</DialogTitle>
                    <DialogDescription>
                        {isDragging
                            ? 'Drop files here to add them.'
                            : 'Select or drop files, review your selection, then start the upload.'}
                    </DialogDescription>
                </DialogHeader>

                {/* Keep short lists compact and give long lists a styled scrollbar. */}
                {files.length > 4 ? (
                    <ScrollArea className='h-[min(18rem,40vh)] w-full max-w-full min-w-0'>
                        <div className='flex w-full min-w-0 flex-col gap-2 pr-3'>{fileItems}</div>
                    </ScrollArea>
                ) : (
                    <div className='flex w-full max-w-full min-w-0 flex-col gap-2 overflow-hidden'>
                        {fileItems}
                    </div>
                )}

                <div className='flex flex-col gap-2'>
                    <span className='text-muted-foreground self-end text-right text-xs whitespace-nowrap'>
                        {files.length} {fileLabel} · {formatFileSize(totalSize)}
                    </span>
                    <DialogFooter className='flex-row flex-wrap items-center justify-between sm:justify-between'>
                        <Button
                            type='button'
                            variant='outline'
                            disabled={isUploading}
                            onClick={onSelectFiles}
                        >
                            <HugeiconsIcon
                                icon={Add01Icon}
                                data-icon='inline-start'
                                strokeWidth={2}
                            />
                            {files.length ? 'Add more files' : 'Select files'}
                        </Button>
                        <div className='flex items-center gap-2'>
                            <Button
                                type='button'
                                variant='outline'
                                disabled={isUploading}
                                onClick={() => handleOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type='button'
                                disabled={!files.length || isUploading}
                                onClick={onUpload}
                            >
                                {isUploading ? 'Uploading…' : 'Upload'}
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
