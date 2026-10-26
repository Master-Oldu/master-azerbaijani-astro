// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://masterazerbaijani.com',
  integrations: [
    mdx(),
    sitemap({
      // The private dashboard is omitted. Every existing public URL still passes.
      filter: (page) => {
        const path = new URL(page).pathname;
        return path !== '/dashboard' && !path.startsWith('/dashboard/');
      },
    }),
  ],
});
