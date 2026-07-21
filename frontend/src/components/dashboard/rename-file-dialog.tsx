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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
    InputGroupText,
} from '@/components/ui/input-group';
import { splitFileName } from '@/lib/files';

type RenameFileDialogProps = {
    fileName: string;
    onOpenChange: (open: boolean) => void;
    onConfirm: (fileName: string) => void;
};

export function RenameFileDialog({ fileName, onOpenChange, onConfirm }: RenameFileDialogProps) {
    const { stem, extension } = splitFileName(fileName);
    const [newFileStem, setNewFileStem] = useState(stem);
    const trimmedFileStem = newFileStem.trim();

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!trimmedFileStem) return;
        onConfirm(`${trimmedFileStem}${extension}`);
    }

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false}>
                <form className='flex flex-col gap-6' onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Rename file</DialogTitle>
                        <DialogDescription>Enter a new name for “{fileName}”.</DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor='file-name'>File name</FieldLabel>
                            <InputGroup>
                                <InputGroupInput
                                    id='file-name'
                                    autoFocus
                                    value={newFileStem}
                                    onChange={(event) => setNewFileStem(event.target.value)}
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
                        </Field>
                    </FieldGroup>
                    <DialogFooter>
                        <DialogClose render={<Button type='button' variant='outline' />}>
                            Cancel
                        </DialogClose>
                        <Button type='submit' disabled={!trimmedFileStem}>
                            Rename
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
