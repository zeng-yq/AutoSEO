import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AutoSEO',
    description: 'SEO 快捷工具集合：GSC/Bing 批量提交 + Ahrefs KD 查询',
    permissions: ['debugger', 'tabs', 'sidePanel', 'storage'],
    host_permissions: [
      'https://search.google.com/*',
      'https://www.bing.com/*',
      'https://ahrefs.com/*',
      'https://trends.google.com/*',
      'https://gemini.google.com/*',
    ],
    action: { default_title: 'AutoSEO' },
    side_panel: { default_path: 'sidepanel/index.html' },
  },
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
