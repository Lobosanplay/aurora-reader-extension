import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const content = mode === 'content';
  return {
    plugins: content ? [tailwindcss()] : [],
    // Library builds retain Node-style environment checks from React unless replaced explicitly.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    publicDir: content ? false : 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: !content,
      sourcemap: false,
      minify: true,
      lib: {
        entry: content ? 'src/content/index.tsx' : 'src/background/service-worker.ts',
        formats: [content ? 'iife' : 'es'],
        name: content ? 'AuroraReader' : undefined,
        fileName: () => content ? 'content.js' : 'background.js'
      }
    },
    test: { environment: 'jsdom' }
  };
});
