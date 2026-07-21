import './index.css';
import { ClerkProvider, useAuth } from '@clerk/react';
import { dark } from '@clerk/ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from '@/router';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable.');
}

const queryClient = new QueryClient();

// Keep the Clerk-to-router bridge next to the application providers.
// eslint-disable-next-line react-refresh/only-export-components
function AppRouter() {
    const auth = useAuth();

    useEffect(() => {
        if (!auth.isLoaded) return;

        // Re-run route guards whenever the active session changes.
        void router.invalidate();
    }, [auth.isLoaded, auth.isSignedIn, auth.sessionId]);

    return <RouterProvider router={router} context={{ auth }} />;
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ClerkProvider
            publishableKey={clerkPublishableKey}
            afterSignOutUrl='/'
            appearance={{ theme: dark }}
        >
            <QueryClientProvider client={queryClient}>
                <AppRouter />
            </QueryClientProvider>
        </ClerkProvider>
    </StrictMode>
);
