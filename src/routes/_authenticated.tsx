import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: ({ context }) => {
        if (!context.auth.isSignedIn) {
            throw redirect({ to: '/sign-in', replace: true });
        }
    },
    component: Outlet,
});
