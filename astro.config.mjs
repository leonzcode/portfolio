import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://leonzhao.dev',
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
