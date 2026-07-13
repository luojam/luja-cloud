import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { UploadDialog } from '@/components/dashboard/upload-dialog';
import { UploadContext } from '@/contexts/upload-context';

type UploadProviderProps = {
    children: ReactNode;
    onUpload?: (files: File[]) => void | Promise<void>;
};

function getFileKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
}

export function UploadProvider({ children, onUpload }: UploadProviderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [open, setOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const openUploadDialog = useCallback(() => setOpen(true), []);
    const selectFiles = useCallback(() => inputRef.current?.click(), []);
    const contextValue = useMemo(
        () => ({ openUploadDialog, selectFiles }),
        [openUploadDialog, selectFiles]
    );

    function addFiles(selectedFiles: File[]) {
        if (!selectedFiles.length) return;

        setFiles((currentFiles) => {
            const existingKeys = new Set(currentFiles.map(getFileKey));
            const newFiles = selectedFiles.filter((file) => !existingKeys.has(getFileKey(file)));
            return [...currentFiles, ...newFiles];
        });
        setOpen(true);

        // Allow selecting the same file after it has been removed.
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

    return (
        <UploadContext.Provider value={contextValue}>
            {children}
            <input
                ref={inputRef}
                type='file'
                multiple
                hidden
                onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
            />
            <UploadDialog
                open={open}
                files={files}
                isUploading={isUploading}
                onOpenChange={handleOpenChange}
                onAddFiles={addFiles}
                onRemoveFile={removeFile}
                onSelectFiles={selectFiles}
                onUpload={confirmUpload}
            />
        </UploadContext.Provider>
    );
}
