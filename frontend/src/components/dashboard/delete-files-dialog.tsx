import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type DeleteFilesDialogProps = {
    fileNames: string[];
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
};

export function DeleteFilesDialog({ fileNames, onOpenChange, onConfirm }: DeleteFilesDialogProps) {
    const fileCount = fileNames.length;
    const fileName = fileNames[0] ?? 'This file';
    const isBulkDelete = fileCount > 1;

    return (
        <AlertDialog open={fileCount > 0} onOpenChange={onOpenChange}>
            <AlertDialogContent size='sm'>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete {isBulkDelete ? `${fileCount} files` : 'file'}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {isBulkDelete
                            ? `These ${fileCount} files will be permanently deleted.`
                            : `“${fileName}” will be permanently deleted.`}{' '}
                        This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant='destructive' onClick={onConfirm}>
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
