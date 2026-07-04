import { defineContentScript } from 'wxt/utils/define-content-script';
import { autoFillFromUrl } from '@lib/gemini/fill';

export default defineContentScript({
  matches: ['https://gemini.google.com/app*'],
  runAt: 'document_idle',
  main() {
    const marker = '__autoseoGeminiFillInitialized';
    if ((window as unknown as Record<string, unknown>)[marker]) return;
    (window as unknown as Record<string, unknown>)[marker] = true;

    void autoFillFromUrl();
  },
});
