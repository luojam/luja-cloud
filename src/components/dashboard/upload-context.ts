import { createContext, useContext } from 'react';

export type UploadContextValue = {
    selectFiles: () => void;
};

export const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload() {
    const context = useContext(UploadContext);

    if (!context) throw new Error('useUpload must be used within an UploadProvider.');

    return context;
}
