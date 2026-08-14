import type { useAuth } from '@clerk/react';
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import { AuthLoadingScreen } from '@/components/auth/auth-loading-screen';

export interface RouterContext {
    auth: ReturnType<typeof useAuth>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootLayout,
});

function RootLayout() {
    const { auth } = Route.useRouteContext();
    const isPublicShareRoute = useRouterState({
        select: (state) => state.matches.some((match) => match.routeId === '/share/$token'),
    });

    // Public share links do not depend on Clerk session restoration.
    if (!isPublicShareRoute && !auth.isLoaded) return <AuthLoadingScreen />;

    return <Outlet />;
}
