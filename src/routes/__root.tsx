import type { useAuth } from '@clerk/react';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

export interface RouterContext {
    auth: ReturnType<typeof useAuth>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootLayout,
});

function RootLayout() {
    return <Outlet />;
}
