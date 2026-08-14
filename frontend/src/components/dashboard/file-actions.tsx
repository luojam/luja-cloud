import {
    Delete02Icon,
    Download04Icon,
    Edit02Icon,
    MoreVerticalIcon,
    Share08Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
import {
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type FileActionsDropdownProps = {
    fileName: string;
    isDownloading: boolean;
    onDelete: () => void;
    onDownload: () => void;
    onOpen: () => void;
    onRename: () => void;
    onShare: () => void;
};

export function FileActionsDropdown({
    fileName,
    isDownloading,
    onDelete,
    onDownload,
    onOpen,
    onRename,
    onShare,
}: FileActionsDropdownProps) {
    return (
        <DropdownMenu
            onOpenChange={(open) => {
                if (open) onOpen();
            }}
        >
            <DropdownMenuTrigger
                render={
                    <Button variant='ghost' size='icon-xs' aria-label={`Actions for ${fileName}`} />
                }
            >
                <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={1.8} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-40' align='end'>
                <DropdownMenuGroup>
                    <DropdownMenuItem disabled={isDownloading} onClick={onDownload}>
                        <HugeiconsIcon icon={Download04Icon} strokeWidth={1.8} />
                        Download
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onRename}>
                        <HugeiconsIcon icon={Edit02Icon} strokeWidth={1.8} />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onShare}>
                        <HugeiconsIcon icon={Share08Icon} strokeWidth={1.8} />
                        Share
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuItem variant='destructive' onClick={onDelete}>
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

type FileActionsContextMenuProps = {
    isDownloading: boolean;
    onDelete: () => void;
    onDownload: () => void;
    onRename: () => void;
    onShare: () => void;
};

export function FileActionsContextMenu({
    isDownloading,
    onDelete,
    onDownload,
    onRename,
    onShare,
}: FileActionsContextMenuProps) {
    return (
        <ContextMenuContent className='w-40'>
            <ContextMenuGroup>
                <ContextMenuItem disabled={isDownloading} onClick={onDownload}>
                    <HugeiconsIcon icon={Download04Icon} strokeWidth={1.8} />
                    Download
                </ContextMenuItem>
                <ContextMenuItem onClick={onRename}>
                    <HugeiconsIcon icon={Edit02Icon} strokeWidth={1.8} />
                    Rename
                </ContextMenuItem>
                <ContextMenuItem onClick={onShare}>
                    <HugeiconsIcon icon={Share08Icon} strokeWidth={1.8} />
                    Share
                </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
                <ContextMenuItem variant='destructive' onClick={onDelete}>
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                    Delete
                </ContextMenuItem>
            </ContextMenuGroup>
        </ContextMenuContent>
    );
}
