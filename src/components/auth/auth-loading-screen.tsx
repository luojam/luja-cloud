import { AuthBackground } from '@/components/auth/auth-background';
import { Spinner } from '@/components/ui/spinner';

export function AuthLoadingScreen() {
    return (
        <AuthBackground>
            <div className='relative flex min-h-svh items-center justify-center'>
                <Spinner className='size-6' />
            </div>
        </AuthBackground>
    );
}
