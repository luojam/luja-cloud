import { Download04Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
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

export type PreparedDownload = {
    fileId: string;
    fileName: string;
    downloadUrl: string;
};

type DownloadFilesDialogProps = {
    downloads: PreparedDownload[];
    onOpenChange: (open: boolean) => void;
};

export function DownloadFilesDialog({ downloads, onOpenChange }: DownloadFilesDialogProps) {
    return (
        <Dialog open={downloads.length > 0} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Downloads ready</DialogTitle>
                    <DialogDescription>
                        Download each file individually. These links expire in five minutes.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className='max-h-72'>
                    <ul className='flex flex-col gap-2 pr-3'>
                        {downloads.map((download) => (
                            <li key={download.fileId}>
                                <Button
                                    className='w-full justify-between'
                                    variant='outline'
                                    render={<a href={download.downloadUrl} />}
                                >
                                    <span className='truncate'>{download.fileName}</span>
                                    <HugeiconsIcon
                                        icon={Download04Icon}
                                        data-icon='inline-end'
                                        strokeWidth={1.8}
                                    />
                                </Button>
                            </li>
                        ))}
                    </ul>
                </ScrollArea>
                <DialogFooter showCloseButton />
            </DialogContent>
        </Dialog>
    );
}
