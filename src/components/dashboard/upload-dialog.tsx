import { Add01Icon, Delete02Icon, File01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type DragEvent, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { UploadContext } from '@/components/dashboard/upload-context';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type UploadProviderProps = {
    children: ReactNode;
    onUpload?: (files: File[]) => void | Promise<void>;
};

function getFileKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function UploadProvider({ children, onUpload }: UploadProviderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const [files, setFiles] = useState<File[]>([]);
    const [open, setOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const openUploadDialog = useCallback(() => setOpen(true), []);
    const selectFiles = useCallback(() => inputRef.current?.click(), []);
    // Let upload entry points choose whether to show the dialog or picker first.
    const contextValue = useMemo(
        () => ({ openUploadDialog, selectFiles }),
        [openUploadDialog, selectFiles]
    );
    const totalSize = files.reduce((total, file) => total + file.size, 0);

    function addFiles(selectedFiles: FileList | null) {
        if (!selectedFiles?.length) return;

        // FileList is live, so copy it before resetting the input below.
        const incomingFiles = Array.from(selectedFiles);
        setFiles((currentFiles) => {
            const existingKeys = new Set(currentFiles.map(getFileKey));
            const newFiles = incomingFiles.filter((file) => !existingKeys.has(getFileKey(file)));
            return [...currentFiles, ...newFiles];
        });
        setOpen(true);

        // Allow selecting the same file again after it has been removed.
        if (inputRef.current) inputRef.current.value = '';
    }

    function removeFile(fileToRemove: File) {
        setFiles((currentFiles) =>
            currentFiles.filter((file) => getFileKey(file) !== getFileKey(fileToRemove))
        );
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
        dragDepthRef.current = 0;
        setIsDragging(false);
        if (!isUploading) addFiles(event.dataTransfer.files);
    }

    function handleOpenChange(nextOpen: boolean) {
        if (isUploading) return;
        setOpen(nextOpen);
        if (!nextOpen) {
            setFiles([]);
            dragDepthRef.current = 0;
            setIsDragging(false);
        }
    }

    async function confirmUpload() {
        if (!files.length) return;

        setIsUploading(true);
        try {
            await onUpload?.(files);
            setOpen(false);
            setFiles([]);
        } finally {
            setIsUploading(false);
        }
    }

    const fileLabel = files.length === 1 ? 'file' : 'files';
    const fileItems = files.map((file) => (
        <div
            key={getFileKey(file)}
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
                onClick={() => removeFile(file)}
            >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
        </div>
    ));

    return (
        <UploadContext.Provider value={contextValue}>
            {children}
            <input
                ref={inputRef}
                type='file'
                multiple
                hidden
                onChange={(event) => addFiles(event.target.files)}
            />
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
                            <div className='flex w-full min-w-0 flex-col gap-2 pr-3'>
                                {fileItems}
                            </div>
                        </ScrollArea>
                    ) : (
                        <div className='flex w-full max-w-full min-w-0 flex-col gap-2 overflow-hidden'>
                            {fileItems}
                        </div>
                    )}

                    {/* Keep the summary close to the actions without adding a roomy row. */}
                    <div className='flex flex-col gap-2'>
                        <span className='text-muted-foreground self-end text-right text-xs whitespace-nowrap'>
                            {files.length} {fileLabel} · {formatFileSize(totalSize)}
                        </span>
                        <DialogFooter className='flex-row flex-wrap items-center justify-between sm:justify-between'>
                            <Button
                                type='button'
                                variant='outline'
                                disabled={isUploading}
                                onClick={selectFiles}
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
                                    onClick={confirmUpload}
                                >
                                    {isUploading ? 'Uploading…' : 'Upload'}
                                </Button>
                            </div>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>
        </UploadContext.Provider>
    );
}
