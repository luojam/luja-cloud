import { createFileRoute } from '@tanstack/react-router';
import { AuthLanding } from '@/components/auth/auth-landing';

export const Route = createFileRoute('/sign-in')({
    component: SignInPage,
});

function SignInPage() {
    return <AuthLanding />;
}
