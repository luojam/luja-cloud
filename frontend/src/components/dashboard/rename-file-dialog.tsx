import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    InputGroupText,
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { splitFileName } from '@/lib/files';

type RenameFileDialogProps = {
    fileName: string;
    onOpenChange: (open: boolean) => void;
    onConfirm: (fileName: string) => Promise<void>;
};

export function RenameFileDialog({ fileName, onOpenChange, onConfirm }: RenameFileDialogProps) {
    const { stem, extension } = splitFileName(fileName);
    const [newFileStem, setNewFileStem] = useState(stem);
    const [isPending, setIsPending] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const trimmedFileStem = newFileStem.trim();

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!trimmedFileStem || isPending) return;

        setIsPending(true);
        setErrorMessage('');
        try {
            await onConfirm(`${trimmedFileStem}${extension}`);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : 'Unable to rename this file. Please try again.'
            );
        } finally {
            setIsPending(false);
        }
    }

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!isPending) onOpenChange(open);
            }}
        >
            <DialogContent showCloseButton={false}>
                <form className='flex flex-col gap-6' onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Rename file</DialogTitle>
                        <DialogDescription>Enter a new name for “{fileName}”.</DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field data-invalid={Boolean(errorMessage)} data-disabled={isPending}>
                            <FieldLabel htmlFor='file-name'>File name</FieldLabel>
                            <InputGroup>
                                <InputGroupInput
                                    id='file-name'
                                    autoFocus
                                    value={newFileStem}
                                    disabled={isPending}
                                    aria-invalid={Boolean(errorMessage)}
                                    onChange={(event) => {
                                        setNewFileStem(event.target.value);
                                        setErrorMessage('');
                                    }}
                                    onFocus={(event) => event.currentTarget.select()}
                                />
                                {extension && (
                                    <InputGroupAddon align='inline-end'>
                                        <InputGroupText>{extension}</InputGroupText>
                                    </InputGroupAddon>
                                )}
                            </InputGroup>
                            {extension && (
                                <FieldDescription>
                                    The {extension} extension will be preserved.
                                </FieldDescription>
                            )}
                            <FieldError>{errorMessage}</FieldError>
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        <DialogClose
                            render={<Button type='button' variant='outline' disabled={isPending} />}
                        >
                            Cancel
                        </DialogClose>
                        <Button type='submit' disabled={!trimmedFileStem || isPending}>
                            {isPending && <Spinner data-icon='inline-start' />}
                            {isPending ? 'Renaming…' : 'Rename'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
