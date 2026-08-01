import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  build: {
    target: 'es2022',
    // The AudioWorklet must be a real file. Left to itself Vite inlines it as
    // a base64 data: URL, which addModule rejects under a strict CSP.
    assetsInlineLimit: 0,
  },
});
