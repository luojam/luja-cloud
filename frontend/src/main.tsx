import './index.css';
import { ClerkProvider, useAuth, type ClerkProviderProps } from '@clerk/react';
import { dark } from '@clerk/ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { router } from '@/router';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable.');
}

const queryClient = new QueryClient();

type ClerkRouterFn = NonNullable<ClerkProviderProps['routerPush']>;
type ClerkRouterMetadata = Parameters<ClerkRouterFn>[1];

function browserNavigate(to: string, replace: boolean, metadata: ClerkRouterMetadata) {
    if (metadata) return metadata.windowNavigate(to);

    if (replace) window.location.replace(to);
    else window.location.assign(to);
}

async function navigateWithRouter(to: string, replace: boolean, metadata: ClerkRouterMetadata) {
    let url: URL;

    try {
        url = new URL(to, window.location.href);
    } catch {
        return browserNavigate(to, replace, metadata);
    }

    const requiresWindowNavigation = metadata?.__internal_metadata?.navigationType === 'window';
    const canUseSpaRouter =
        !requiresWindowNavigation &&
        url.origin === window.location.origin &&
        !url.username &&
        !url.password;

    if (!canUseSpaRouter) return browserNavigate(to, replace, metadata);

    try {
        await router.navigate({
            href: `${url.pathname}${url.search}${url.hash}`,
            replace,
        });
    } catch {
        return browserNavigate(to, replace, metadata);
    }
}

const routerPush: ClerkRouterFn = (to, metadata) => navigateWithRouter(to, false, metadata);
const routerReplace: ClerkRouterFn = (to, metadata) => navigateWithRouter(to, true, metadata);

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
            routerPush={routerPush}
            routerReplace={routerReplace}
            appearance={{ theme: dark }}
            localization={{ signIn: { start: { title: 'Sign in' } } }}
        >
            <QueryClientProvider client={queryClient}>
                <AppRouter />
                <Toaster theme='dark' />
            </QueryClientProvider>
        </ClerkProvider>
    </StrictMode>
);
