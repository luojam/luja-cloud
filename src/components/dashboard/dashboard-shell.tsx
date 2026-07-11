import { UserButton } from '@clerk/react';
import type { ReactNode } from 'react';

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

type DashboardShellProps = {
    children?: ReactNode;
};

function DashboardSidebar() {
    return (
        <Sidebar collapsible='icon'>
            <SidebarHeader>
                <div className='flex h-8 items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center'>
                    <span className='truncate px-2 text-sm font-semibold group-data-[collapsible=icon]:hidden'>
                        Luja Cloud
                    </span>
                    <SidebarTrigger size='icon-lg' />
                </div>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <span className='block text-center'>text</span>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}

export function DashboardShell({ children }: DashboardShellProps) {
    return (
        <TooltipProvider>
            <SidebarProvider className='h-svh min-h-0 overflow-hidden'>
                <DashboardSidebar />
                <SidebarInset className='min-h-0 overflow-y-auto'>
                    <header className='bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6'>
                        <SidebarTrigger className='md:hidden' />
                        <div className='min-w-0 flex-1'>
                            <h1 className='truncate text-sm font-semibold'>Dashboard</h1>
                            <p className='text-muted-foreground truncate text-xs'>Luja Cloud</p>
                        </div>
                        <UserButton />
                    </header>

                    {/* The workspace owns scrolling while the shell stays fixed. */}
                    <div className='flex-1'>
                        <div className='flex w-full flex-col gap-6 p-4 md:p-6'>{children}</div>
                    </div>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    );
}
