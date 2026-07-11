import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribeToViewport(callback: () => void) {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    mediaQuery.addEventListener('change', callback);
    return () => mediaQuery.removeEventListener('change', callback);
}

export function useIsMobile() {
    // Keep the shell in sync with the responsive breakpoint.
    return React.useSyncExternalStore(
        subscribeToViewport,
        () => window.matchMedia(MOBILE_QUERY).matches,
        () => false
    );
}
