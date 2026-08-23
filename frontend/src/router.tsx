import { createRouter } from '@tanstack/react-router';
import { routeTree } from '@/routeTree.gen';

export const router = createRouter({
    routeTree,
    // Clerk supplies the live auth state through RouterProvider.
    // biome-ignore lint/style/noNonNullAssertion: The required context is replaced before routes render.
    context: { auth: undefined! },
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
