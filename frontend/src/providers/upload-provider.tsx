import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { UploadDialog } from '@/components/dashboard/upload-dialog';
import { UploadContext } from '@/contexts/upload-context';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/files-api';
import { getUploadFileFingerprint, mergeUploadFiles } from '@/lib/files';

export type UploadBatchResult = {
    uploadedFiles: File[];
    error?: string;
};

type UploadProviderProps = {
    children: ReactNode;
    onUpload: (files: File[]) => Promise<UploadBatchResult>;
};

export function UploadProvider({ children, onUpload }: UploadProviderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [open, setOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string>();

    const openUploadDialog = useCallback(() => setOpen(true), []);
    const selectFiles = useCallback(() => inputRef.current?.click(), []);
    const contextValue = useMemo(() => ({ openUploadDialog }), [openUploadDialog]);

    function addFiles(selectedFiles: File[]) {
        if (!selectedFiles.length) return;

        setFiles((currentFiles) => mergeUploadFiles(currentFiles, selectedFiles));
        setUploadError(undefined);
        setOpen(true);

        // Allow selecting the same file after it has been removed.
        if (inputRef.current) inputRef.current.value = '';
    }

    function removeFile(fileToRemove: File) {
        const fingerprint = getUploadFileFingerprint(fileToRemove);
        setFiles((currentFiles) =>
            currentFiles.filter((file) => getUploadFileFingerprint(file) !== fingerprint)
        );
        setUploadError(undefined);
    }

    function handleOpenChange(nextOpen: boolean) {
        if (isUploading) return;
        setOpen(nextOpen);
        if (!nextOpen) {
            setFiles([]);
            setUploadError(undefined);
        }
    }

    async function confirmUpload() {
        if (!files.length || isUploading) return;
        if (files.some((file) => file.size > MAX_UPLOAD_SIZE_BYTES)) {
            setUploadError('Remove files larger than 100 MB before uploading.');
            return;
        }

        setUploadError(undefined);
        setIsUploading(true);
        try {
            const result = await onUpload(files);
            const uploaded = new Set(result.uploadedFiles.map(getUploadFileFingerprint));
            const remaining = files.filter((file) => !uploaded.has(getUploadFileFingerprint(file)));
            setFiles(remaining);
            setUploadError(result.error);
            if (!remaining.length && !result.error) setOpen(false);
        } catch {
            setUploadError('The upload failed. Please try again.');
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
                error={uploadError}
                onOpenChange={handleOpenChange}
                onAddFiles={addFiles}
                onRemoveFile={removeFile}
                onSelectFiles={selectFiles}
                onUpload={confirmUpload}
            />
        </UploadContext.Provider>
    );
}
