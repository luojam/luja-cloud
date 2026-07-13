import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AuthLoadingScreen } from '@/components/auth/auth-loading-screen';

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: ({ context }) => {
        if (context.auth.isLoaded && !context.auth.isSignedIn) {
            throw redirect({ to: '/sign-in', replace: true });
        }
    },
    component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
    const { auth } = Route.useRouteContext();

    // Never reveal protected routes before the guard settles.
    if (!auth.isLoaded || !auth.isSignedIn) return <AuthLoadingScreen />;

    return <Outlet />;
}
