import { Add01Icon, Delete02Icon, File01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

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
    const [files, setFiles] = useState<File[]>([]);
    const [open, setOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const selectFiles = useCallback(() => inputRef.current?.click(), []);
    const contextValue = useMemo(() => ({ selectFiles }), [selectFiles]);
    const totalSize = files.reduce((total, file) => total + file.size, 0);

    function addFiles(selectedFiles: FileList | null) {
        if (!selectedFiles?.length) return;

        setFiles((currentFiles) => {
            const existingKeys = new Set(currentFiles.map(getFileKey));
            const newFiles = Array.from(selectedFiles).filter(
                (file) => !existingKeys.has(getFileKey(file))
            );
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

    function handleOpenChange(nextOpen: boolean) {
        if (isUploading) return;
        setOpen(nextOpen);
        if (!nextOpen) setFiles([]);
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
                <DialogContent className='sm:max-w-lg'>
                    <DialogHeader>
                        <DialogTitle>Upload files</DialogTitle>
                        <DialogDescription>
                            Review your selection or add more files before uploading.
                        </DialogDescription>
                    </DialogHeader>

                    <div className='flex max-h-72 flex-col gap-2 overflow-y-auto'>
                        {files.map((file) => (
                            <div
                                key={getFileKey(file)}
                                className='bg-muted/50 flex items-center gap-3 rounded-md p-2'
                            >
                                <HugeiconsIcon
                                    icon={File01Icon}
                                    className='shrink-0'
                                    strokeWidth={2}
                                />
                                <div className='min-w-0 flex-1'>
                                    <p className='truncate text-sm font-medium'>{file.name}</p>
                                    <p className='text-muted-foreground'>
                                        {formatFileSize(file.size)}
                                    </p>
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
                        ))}
                    </div>

                    <div className='flex items-center justify-between gap-3'>
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
                            Add more files
                        </Button>
                        <span className='text-muted-foreground text-xs'>
                            {files.length} {fileLabel} · {formatFileSize(totalSize)}
                        </span>
                    </div>

                    <DialogFooter>
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
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </UploadContext.Provider>
    );
}
