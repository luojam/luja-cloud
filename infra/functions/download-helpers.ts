export type PresignDownload = (input: {
    bucketName: string;
    objectKey: string;
    contentType: string;
    contentDisposition: string;
    expiresIn: number;
}) => Promise<string>;

/** Builds an RFC 6266 disposition without allowing metadata to add another header/value. */
export function attachmentDisposition(fileName: string): string {
    const visibleName =
        fileName
            .normalize('NFC')
            // biome-ignore lint/suspicious/noControlCharactersInRegex: These ranges remove unsafe filename characters.
            .replace(/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/g, '_')
            .replace(/[\\/]/g, '_')
            .trim() || 'download';
    const asciiName = visibleName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(visibleName).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );

    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
