import { Copy01Icon, Share08Icon, Tick02Icon, Unlink01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRef, useState } from 'react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { FileRecord } from '@/lib/files';
import { ShareApiError } from '@/lib/shares-api';

type ShareFileDialogProps = {
    file: FileRecord;
    onOpenChange: (open: boolean) => void;
    onCreate: (file: FileRecord) => Promise<string>;
    onRevoke: (file: FileRecord) => Promise<void>;
};

type CopyStatus = 'error' | 'success' | null;

export function ShareFileDialog({ file, onOpenChange, onCreate, onRevoke }: ShareFileDialogProps) {
    const [sharePath, setSharePath] = useState<string | null>(null);
    const isShared = file.isShared || sharePath !== null;
    const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [isRevoking, setIsRevoking] = useState(false);
    const [isConfirmingRevoke, setIsConfirmingRevoke] = useState(false);
    const actionInProgress = useRef(false);
    const isPending = isCreating || isRevoking;

    async function enableSharing() {
        if (actionInProgress.current || isShared) return;

        actionInProgress.current = true;
        setIsCreating(true);
        setCopyStatus(null);
        setErrorMessage('');
        try {
            const path = await onCreate(file);
            setSharePath(path);
        } catch (error) {
            setErrorMessage(
                error instanceof ShareApiError
                    ? error.message
                    : 'Unable to enable sharing. Please try again.'
            );
        } finally {
            actionInProgress.current = false;
            setIsCreating(false);
        }
    }

    async function disableSharing() {
        if (actionInProgress.current || !isShared) return;

        actionInProgress.current = true;
        setIsRevoking(true);
        setCopyStatus(null);
        setErrorMessage('');
        try {
            await onRevoke(file);
            setSharePath(null);
            setIsConfirmingRevoke(false);
        } catch (error) {
            setErrorMessage(
                error instanceof ShareApiError
                    ? error.message
                    : 'Unable to disable sharing. Please try again.'
            );
            setIsConfirmingRevoke(false);
        } finally {
            actionInProgress.current = false;
            setIsRevoking(false);
        }
    }

    async function copyShareLink() {
        if (!sharePath) return;

        setCopyStatus(null);
        try {
            if (!navigator.clipboard) throw new Error();
            await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`);
            setCopyStatus('success');
        } catch {
            setCopyStatus('error');
        }
    }

    return (
        <>
            <Dialog
                open
                onOpenChange={(open) => {
                    if (!open && !isPending) onOpenChange(false);
                }}
            >
                <DialogContent showCloseButton={!isPending}>
                    <DialogHeader>
                        <div className='flex items-center gap-2'>
                            <DialogTitle>Share “{file.name}”</DialogTitle>
                            <Badge variant={isShared ? 'secondary' : 'outline'}>
                                {isShared ? 'Sharing on' : 'Sharing off'}
                            </Badge>
                        </div>
                        <DialogDescription>
                            {isShared
                                ? 'Anyone with the link can download this file without signing in.'
                                : 'Create a private, unguessable link for this file.'}
                        </DialogDescription>
                    </DialogHeader>

                    {sharePath ? (
                        <Alert>
                            <HugeiconsIcon icon={Tick02Icon} strokeWidth={1.8} />
                            <AlertTitle>Your new link is ready</AlertTitle>
                            <AlertDescription>
                                Copy it now. For security, it cannot be shown again after this
                                dialog closes.
                            </AlertDescription>
                        </Alert>
                    ) : isShared ? (
                        <Alert>
                            <HugeiconsIcon icon={Share08Icon} strokeWidth={1.8} />
                            <AlertTitle>This file is shared</AlertTitle>
                            <AlertDescription>
                                Existing links cannot be retrieved. Disable sharing to make the
                                current link unusable.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <Alert>
                            <HugeiconsIcon icon={Share08Icon} strokeWidth={1.8} />
                            <AlertTitle>Sharing is disabled</AlertTitle>
                            <AlertDescription>
                                Enabling sharing creates a new link. The link remains active until
                                you disable sharing or delete the file.
                            </AlertDescription>
                        </Alert>
                    )}

                    {sharePath && (
                        <Field>
                            <FieldLabel htmlFor='share-link'>Share link</FieldLabel>
                            <Input
                                id='share-link'
                                type='url'
                                readOnly
                                value={`${window.location.origin}${sharePath}`}
                                onFocus={(event) => event.currentTarget.select()}
                            />
                        </Field>
                    )}

                    {errorMessage && (
                        <Alert variant='destructive'>
                            <AlertTitle>Sharing could not be updated</AlertTitle>
                            <AlertDescription>{errorMessage}</AlertDescription>
                        </Alert>
                    )}

                    {copyStatus && (
                        <p
                            className='text-muted-foreground text-sm'
                            role={copyStatus === 'error' ? 'alert' : 'status'}
                        >
                            {copyStatus === 'success'
                                ? 'Link copied to your clipboard.'
                                : 'The link could not be copied automatically. Select the link above and copy it manually.'}
                        </p>
                    )}

                    <DialogFooter>
                        <Button
                            type='button'
                            variant='outline'
                            disabled={isPending}
                            onClick={() => onOpenChange(false)}
                        >
                            Close
                        </Button>
                        {sharePath && (
                            <Button
                                type='button'
                                disabled={isPending}
                                onClick={() => void copyShareLink()}
                            >
                                <HugeiconsIcon
                                    icon={Copy01Icon}
                                    data-icon='inline-start'
                                    strokeWidth={1.8}
                                />
                                Copy link
                            </Button>
                        )}
                        {isShared ? (
                            <Button
                                type='button'
                                variant='destructive'
                                disabled={isPending}
                                onClick={() => setIsConfirmingRevoke(true)}
                            >
                                {isRevoking ? (
                                    <Spinner data-icon='inline-start' />
                                ) : (
                                    <HugeiconsIcon
                                        icon={Unlink01Icon}
                                        data-icon='inline-start'
                                        strokeWidth={1.8}
                                    />
                                )}
                                {isRevoking ? 'Disabling…' : 'Disable sharing'}
                            </Button>
                        ) : (
                            <Button
                                type='button'
                                disabled={isPending}
                                onClick={() => void enableSharing()}
                            >
                                {isCreating ? (
                                    <Spinner data-icon='inline-start' />
                                ) : (
                                    <HugeiconsIcon
                                        icon={Share08Icon}
                                        data-icon='inline-start'
                                        strokeWidth={1.8}
                                    />
                                )}
                                {isCreating ? 'Creating…' : 'Create link'}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={isConfirmingRevoke}
                onOpenChange={(open) => {
                    if (!isRevoking) setIsConfirmingRevoke(open);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disable this sharing link?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Disabling this link prevents new downloads. Download URLs already issued
                            may continue working for up to five minutes. Sharing again will create a
                            different link.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isRevoking}>Keep sharing</AlertDialogCancel>
                        <AlertDialogAction
                            variant='destructive'
                            disabled={isRevoking}
                            onClick={() => void disableSharing()}
                        >
                            {isRevoking && <Spinner data-icon='inline-start' />}
                            {isRevoking ? 'Disabling…' : 'Disable sharing'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
