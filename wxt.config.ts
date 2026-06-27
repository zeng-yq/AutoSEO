import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      alias: {
        '@lib': fileURLToPath(new URL('./lib', import.meta.url)),
        '@components': fileURLToPath(new URL('./entrypoints/sidepanel/components', import.meta.url)),
        '@pages': fileURLToPath(new URL('./entrypoints/sidepanel/pages', import.meta.url)),
        '@hooks': fileURLToPath(new URL('./entrypoints/sidepanel/hooks', import.meta.url)),
      },
    },
  }),
});
