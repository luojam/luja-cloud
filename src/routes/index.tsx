import { createFileRoute } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/')({
    component: HomePage,
});

function HomePage() {
    return (
        <main className='flex min-h-svh flex-col items-center justify-center gap-4 p-6'>
            <h1 className='text-2xl font-semibold'>Luja Cloud</h1>
            <p className='text-muted-foreground'>The project is ready to build.</p>
            <Button>Get started</Button>
        </main>
    );
}
