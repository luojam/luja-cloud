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

type RenameFileDialogProps = {
    fileName: string;
    onOpenChange: (open: boolean) => void;
    onConfirm: (fileName: string) => void;
};

const compoundExtensions = [
    // Archives and package formats.
    '.pkg.tar.zst',
    '.pkg.tar.xz',
    '.pkg.tar.gz',
    '.src.tar.gz',
    '.tar.bz2',
    '.tar.lz4',
    '.tar.lzma',
    '.tar.zst',
    '.tar.br',
    '.tar.gz',
    '.tar.lz',
    '.tar.xz',
    '.tar.z',
    '.cpio.bz2',
    '.cpio.gz',
    '.cpio.xz',
    // Compressed data, database, disk, and scientific formats.
    '.jsonl.gz',
    '.ndjson.gz',
    '.fastq.gz',
    '.fasta.gz',
    '.csv.bz2',
    '.csv.gz',
    '.csv.xz',
    '.json.bz2',
    '.json.gz',
    '.json.xz',
    '.sql.bz2',
    '.sql.gz',
    '.sql.xz',
    '.vcf.gz',
    '.bed.gz',
    '.fq.gz',
    '.fa.gz',
    '.nii.gz',
    '.img.gz',
    '.iso.gz',
    // Type declarations, source maps, and web assets.
    '.d.cts',
    '.d.mts',
    '.d.ts',
    '.cjs.map',
    '.css.map',
    '.jsx.map',
    '.mjs.map',
    '.tsx.map',
    '.js.map',
    '.ts.map',
    '.min.css',
    '.min.js',
    '.module.css',
    '.module.less',
    '.module.sass',
    '.module.scss',
    '.user.js',
    // Common server-side template and include formats.
    '.blade.php',
    '.inc.php',
    '.module.php',
    '.tpl.php',
].sort((left, right) => right.length - left.length);

function splitFileName(fileName: string) {
    const lowerFileName = fileName.toLowerCase();
    const compoundExtension = compoundExtensions.find(
        (extension) => lowerFileName.endsWith(extension) && fileName.length > extension.length
    );

    if (compoundExtension) {
        const extensionStart = fileName.length - compoundExtension.length;
        return {
            stem: fileName.slice(0, extensionStart),
            extension: fileName.slice(extensionStart),
        };
    }

    const extensionStart = fileName.lastIndexOf('.');
    // A leading dot belongs to a dotfile name rather than an extension.
    if (extensionStart <= 0) return { stem: fileName, extension: '' };

    return {
        stem: fileName.slice(0, extensionStart),
        extension: fileName.slice(extensionStart),
    };
}

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
