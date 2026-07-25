import { Spinner } from '@/components/ui/spinner';
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
    errorMessage: string;
    isPending: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
};

export function DeleteFilesDialog({
    fileNames,
    errorMessage,
    isPending,
    onOpenChange,
    onConfirm,
}: DeleteFilesDialogProps) {
    const fileCount = fileNames.length;
    const fileName = fileNames[0] ?? 'This file';
    const isBulkDelete = fileCount > 1;

    return (
        <AlertDialog
            open={fileCount > 0}
            onOpenChange={(open) => {
                if (!isPending) onOpenChange(open);
            }}
        >
            <AlertDialogContent size='sm'>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete {isBulkDelete ? `${fileCount} files` : 'file'}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {isBulkDelete
                            ? `These ${fileCount} files will be immediately and permanently deleted.`
                            : `“${fileName}” will be immediately and permanently deleted.`}{' '}
                        This action cannot be undone.
                    </AlertDialogDescription>
                    {errorMessage && (
                        <p className='text-destructive text-sm' role='alert'>
                            {errorMessage}
                        </p>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        variant='destructive'
                        disabled={isPending}
                        onClick={(event) => {
                            // Keep the controlled dialog mounted until the async batch resolves.
                            event.preventDefault();
                            onConfirm();
                        }}
                    >
                        {isPending && <Spinner data-icon='inline-start' />}
                        {isPending ? 'Deleting…' : 'Delete'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
