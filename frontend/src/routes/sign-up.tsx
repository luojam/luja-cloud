import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthLanding } from '@/components/auth/auth-landing';
import { AuthLoadingScreen } from '@/components/auth/auth-loading-screen';

export const Route = createFileRoute('/sign-up')({
    beforeLoad: ({ context }) => {
        if (context.auth.isLoaded && context.auth.isSignedIn) {
            throw redirect({ to: '/dashboard', replace: true });
        }
    },
    component: SignUpPage,
});

function SignUpPage() {
    const { auth } = Route.useRouteContext();

    // Hold the loading screen while the signed-in redirect completes.
    if (auth.isSignedIn) return <AuthLoadingScreen />;

    return <AuthLanding mode='sign-up' />;
}
