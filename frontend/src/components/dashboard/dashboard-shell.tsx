import { UserButton, useUser } from '@clerk/react';
import { FileUploadIcon, MoreVerticalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useUpload } from '@/contexts/upload-context';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuItem,
    SidebarProvider,
    SidebarSeparator,
    SidebarTrigger,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

type DashboardShellProps = {
    children?: ReactNode;
};

function DashboardSidebar() {
    const { isLoaded, user } = useUser();
    const { openUploadDialog } = useUpload();
    const userName =
        user?.fullName ||
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        user?.username ||
        user?.primaryEmailAddress?.emailAddress ||
        user?.emailAddresses[0]?.emailAddress ||
        (isLoaded ? 'User' : 'Loading…');

    return (
        <Sidebar collapsible='icon'>
            <SidebarHeader>
                <div className='flex h-8 items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center'>
                    <span className='truncate px-2 text-sm font-semibold group-data-[collapsible=icon]:hidden'>
                        luja Cloud
                    </span>
                    <SidebarTrigger size='icon-lg' />
                </div>
            </SidebarHeader>
            <SidebarSeparator className='data-horizontal:w-[calc(100%-1rem)]' />
            <SidebarContent className='py-2'>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <Button
                                    type='button'
                                    onClick={openUploadDialog}
                                    className='w-full group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:has-data-[icon=inline-start]:pl-0'
                                >
                                    <HugeiconsIcon
                                        icon={FileUploadIcon}
                                        data-icon='inline-start'
                                        strokeWidth={2}
                                    />
                                    <span className='group-data-[collapsible=icon]:hidden'>
                                        Upload
                                    </span>
                                </Button>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <div className='hover:bg-sidebar-accent relative flex items-center gap-3 rounded-md p-2 transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1'>
                    <UserButton
                        appearance={{
                            elements: {
                                // Let Clerk's native trigger own the full footer hit area.
                                userButtonTrigger:
                                    '!static after:absolute after:inset-0 after:content-[""]',
                            },
                        }}
                    />
                    <span className='min-w-0 flex-1 truncate text-sm font-medium group-data-[collapsible=icon]:hidden'>
                        {userName}
                    </span>
                    {/* Hint that the avatar opens the account menu. */}
                    <HugeiconsIcon
                        icon={MoreVerticalIcon}
                        className='text-muted-foreground size-4 shrink-0 group-data-[collapsible=icon]:hidden'
                        strokeWidth={2}
                    />
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}

export function DashboardShell({ children }: DashboardShellProps) {
    return (
        <TooltipProvider>
            <SidebarProvider className='h-svh min-h-0 overflow-hidden'>
                <DashboardSidebar />
                <SidebarInset className='min-h-0 overflow-y-auto'>
                    {/* The workspace owns scrolling while the shell stays fixed. */}
                    <div className='flex-1'>
                        <div className='flex w-full flex-col gap-6 p-4 md:p-6'>
                            {/* Keep the sidebar reachable on narrow screens. */}
                            <SidebarTrigger className='md:hidden' />
                            {children}
                        </div>
                    </div>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    );
}
