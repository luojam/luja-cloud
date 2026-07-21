import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
    const apiProxyTarget = loadEnv(mode, process.cwd(), '').API_PROXY_TARGET?.trim();

    if (command === 'serve' && !apiProxyTarget) {
        throw new Error(
            'Missing API_PROXY_TARGET environment variable. Set it to the deployed API or CloudFront origin.'
        );
    }

    return {
        plugins: [
            tanstackRouter({ target: 'react', autoCodeSplitting: true }),
            react(),
            tailwindcss(),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: apiProxyTarget
            ? {
                  proxy: {
                      '/api': {
                          target: apiProxyTarget,
                          changeOrigin: true,
                      },
                  },
              }
            : undefined,
    };
});
