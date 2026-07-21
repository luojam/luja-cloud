export type FileRecord = {
    id: string;
    name: string;
    mimeType: string;
    createdAt: string;
    modifiedAt: string;
    sizeBytes: number;
};

export type FileNameParts = {
    stem: string;
    extension: string;
};

const fileSizeUnits = ['B', 'KB', 'MB', 'GB', 'TB'];
const fileSizeFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
});
const fileDateFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
});
const fileNameCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

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

export function formatFileSize(bytes: number) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';

    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < fileSizeUnits.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${fileSizeFormatter.format(value)} ${fileSizeUnits[unitIndex]}`;
}

export function formatFileDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : fileDateFormatter.format(date);
}

export function splitFileName(fileName: string): FileNameParts {
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

export function getUploadFileFingerprint(file: File) {
    // Include every stable browser-provided field without delimiter ambiguity.
    return JSON.stringify([
        file.name,
        file.size,
        file.lastModified,
        file.type,
        file.webkitRelativePath,
    ]);
}

export function mergeUploadFiles(current: File[], incoming: File[]) {
    const fingerprints = new Set(current.map(getUploadFileFingerprint));
    const additions: File[] = [];

    for (const file of incoming) {
        const fingerprint = getUploadFileFingerprint(file);
        if (fingerprints.has(fingerprint)) continue;

        fingerprints.add(fingerprint);
        additions.push(file);
    }

    return [...current, ...additions];
}

export function compareFilesByName(left: FileRecord, right: FileRecord) {
    return fileNameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id);
}

export function compareFilesByModified(left: FileRecord, right: FileRecord) {
    const difference = Date.parse(left.modifiedAt) - Date.parse(right.modifiedAt);
    return difference || compareFilesByName(left, right);
}

export function compareFilesBySize(left: FileRecord, right: FileRecord) {
    return left.sizeBytes - right.sizeBytes || compareFilesByName(left, right);
}
