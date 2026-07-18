import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'QuickSEO',
    description: 'SEO 快捷工具集合：GSC/Bing 批量提交 + Ahrefs KD 查询',
    permissions: ['tabs', 'sidePanel', 'storage', 'declarativeNetRequestWithHostAccess', 'cookies'],
    host_permissions: ['https://www.bing.com/*', 'https://ahrefs.com/*', '<all_urls>'],
    action: {
      default_title: 'QuickSEO',
      default_icon: { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png' },
    },
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
