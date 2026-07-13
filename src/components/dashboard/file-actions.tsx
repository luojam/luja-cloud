import {
    Delete02Icon,
    Download04Icon,
    Edit02Icon,
    MoreVerticalIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

import { Button } from '@/components/ui/button';
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type FileActionsDropdownProps = {
    fileName: string;
    onOpen: () => void;
};

export function FileActionsDropdown({ fileName, onOpen }: FileActionsDropdownProps) {
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
                <DropdownMenuItem>
                    <HugeiconsIcon icon={Download04Icon} strokeWidth={1.8} />
                    Download
                </DropdownMenuItem>
                <DropdownMenuItem>
                    <HugeiconsIcon icon={Edit02Icon} strokeWidth={1.8} />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive'>
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function FileActionsContextMenu() {
    return (
        <ContextMenuContent className='w-40'>
            <ContextMenuItem>
                <HugeiconsIcon icon={Download04Icon} strokeWidth={1.8} />
                Download
            </ContextMenuItem>
            <ContextMenuItem>
                <HugeiconsIcon icon={Edit02Icon} strokeWidth={1.8} />
                Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant='destructive'>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                Delete
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
