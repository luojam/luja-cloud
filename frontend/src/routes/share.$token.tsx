import {
    AlertCircleIcon,
    Download04Icon,
    FileNotFoundIcon,
    ReloadIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AuthBackground } from '@/components/auth/auth-background';
import { BrandMark } from '@/components/auth/brand-mark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { formatFileSize } from '@/lib/files';
import { getPublicShareDownloadUrl, getPublicShareMetadata, ShareApiError } from '@/lib/shares-api';

export const Route = createFileRoute('/share/$token')({
    component: PublicSharePage,
});

type StatusCardProps = ComponentProps<typeof Card> & {
    heading: ReactNode;
    description: ReactNode;
    footer: ReactNode;
    titleClassName?: string;
};

function StatusCard({
    heading,
    description,
    footer,
    titleClassName,
    children,
    ...props
}: StatusCardProps) {
    return (
        <Card {...props}>
            <CardHeader>
                <CardTitle className={titleClassName}>
                    <h2>{heading}</h2>
                </CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
            <CardFooter>{footer}</CardFooter>
        </Card>
    );
}

function PublicSharePage() {
    const { token } = Route.useParams();
    return <PublicShareContent key={token} token={token} />;
}

function PublicShareContent({ token }: { token: string }) {
    const metadataQuery = useQuery({
        queryKey: ['public-share-metadata', token],
        queryFn: ({ signal }) => getPublicShareMetadata(token, signal),
        retry: false,
        networkMode: 'always',
        refetchOnWindowFocus: false,
    });
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState('');
    const [downloadUnavailable, setDownloadUnavailable] = useState(false);
    const downloadControllerRef = useRef<AbortController | null>(null);

    useEffect(
        () => () => {
            downloadControllerRef.current?.abort();
        },
        []
    );

    function retryResolution() {
        setDownloadUnavailable(false);
        setDownloadError('');
        void metadataQuery.refetch();
    }

    async function downloadFile() {
        if (isDownloading) return;

        const controller = new AbortController();
        downloadControllerRef.current = controller;
        setIsDownloading(true);
        setDownloadError('');
        try {
            const downloadUrl = await getPublicShareDownloadUrl(token, controller.signal);
            if (controller.signal.aborted) return;

            // Use the short-lived S3 URL immediately instead of retaining it in state or storage.
            const anchor = document.createElement('a');
            anchor.href = downloadUrl;
            anchor.rel = 'noopener noreferrer';
            document.body.append(anchor);
            try {
                anchor.click();
            } finally {
                anchor.remove();
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            if (error instanceof ShareApiError && error.kind === 'unavailable') {
                setDownloadUnavailable(true);
            } else {
                setDownloadError('The download could not be prepared. Please try again.');
            }
        } finally {
            if (downloadControllerRef.current === controller) {
                downloadControllerRef.current = null;
            }
            if (!controller.signal.aborted) setIsDownloading(false);
        }
    }

    const isUnavailable =
        downloadUnavailable ||
        (metadataQuery.error instanceof ShareApiError &&
            metadataQuery.error.kind === 'unavailable');

    return (
        <AuthBackground>
            <div className='relative mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-8 px-4 py-10'>
                <div className='flex justify-center'>
                    <BrandMark />
                </div>

                <div aria-live='polite' aria-atomic='true'>
                    {metadataQuery.isPending || metadataQuery.isFetching ? (
                        <StatusCard
                            heading='Opening shared file'
                            description='Checking that this link is still available.'
                            footer={
                                <span className='text-muted-foreground flex items-center gap-2 text-sm'>
                                    <Spinner />
                                    Loading…
                                </span>
                            }
                            aria-busy='true'
                            aria-label='Loading shared file'
                        >
                            <div aria-hidden='true' className='flex flex-col gap-3'>
                                <Skeleton className='h-6 w-2/3' />
                                <Skeleton className='h-4 w-1/2' />
                                <Skeleton className='h-9 w-full' />
                            </div>
                        </StatusCard>
                    ) : isUnavailable ? (
                        <StatusCard
                            heading='Shared file unavailable'
                            description='This link may have been disabled, deleted, or entered incorrectly.'
                            footer={
                                <Button type='button' variant='outline' onClick={retryResolution}>
                                    <HugeiconsIcon
                                        icon={ReloadIcon}
                                        data-icon='inline-start'
                                        strokeWidth={1.8}
                                    />
                                    Check again
                                </Button>
                            }
                        >
                            <Empty className='border'>
                                <EmptyHeader>
                                    <EmptyMedia variant='icon'>
                                        <HugeiconsIcon icon={FileNotFoundIcon} strokeWidth={1.8} />
                                    </EmptyMedia>
                                    <EmptyTitle>The file cannot be opened</EmptyTitle>
                                    <EmptyDescription>
                                        Ask the owner for a new sharing link.
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        </StatusCard>
                    ) : metadataQuery.isError ? (
                        <StatusCard
                            heading='Unable to open shared file'
                            description='A temporary problem prevented this link from being checked.'
                            footer={
                                <Button type='button' onClick={retryResolution}>
                                    <HugeiconsIcon
                                        icon={ReloadIcon}
                                        data-icon='inline-start'
                                        strokeWidth={1.8}
                                    />
                                    Retry
                                </Button>
                            }
                        >
                            <Alert variant='destructive'>
                                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.8} />
                                <AlertTitle>Something went wrong</AlertTitle>
                                <AlertDescription>
                                    Check your connection, then try again.
                                </AlertDescription>
                            </Alert>
                        </StatusCard>
                    ) : (
                        <StatusCard
                            heading={metadataQuery.data.name}
                            description='Shared with you through luja Cloud'
                            titleClassName='break-words'
                            footer={
                                <Button
                                    type='button'
                                    className='w-full'
                                    disabled={isDownloading}
                                    onClick={() => void downloadFile()}
                                >
                                    {isDownloading ? (
                                        <Spinner data-icon='inline-start' />
                                    ) : (
                                        <HugeiconsIcon
                                            icon={Download04Icon}
                                            data-icon='inline-start'
                                            strokeWidth={1.8}
                                        />
                                    )}
                                    {isDownloading ? 'Preparing download…' : 'Download'}
                                </Button>
                            }
                        >
                            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
                                <dt className='text-muted-foreground'>Type</dt>
                                <dd className='min-w-0 text-right break-words'>
                                    {metadataQuery.data.mimeType}
                                </dd>
                                <dt className='text-muted-foreground'>Size</dt>
                                <dd className='text-right'>
                                    {formatFileSize(metadataQuery.data.sizeBytes)}
                                </dd>
                            </dl>
                            {downloadError && (
                                <Alert variant='destructive'>
                                    <AlertTitle>Download unavailable</AlertTitle>
                                    <AlertDescription>{downloadError}</AlertDescription>
                                </Alert>
                            )}
                        </StatusCard>
                    )}
                </div>
            </div>
        </AuthBackground>
    );
}
