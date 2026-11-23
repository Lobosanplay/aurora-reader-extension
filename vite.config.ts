import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveApiOrigin } from './src/services/api-client';

export default defineConfig(({ mode }) => {
  const content = mode === 'content';
  const env = loadEnv('worker', process.cwd(), 'VITE_');
  const url = env.VITE_API_BASE_URL?.trim();
  if (env.VITE_API_MODE && !['local', 'production'].includes(env.VITE_API_MODE)) {
    throw new Error('VITE_API_MODE must be local or production.');
  }
  if (env.VITE_API_MODE === 'local' && !url) throw new Error('Local API mode requires VITE_API_BASE_URL.');
  const origin = url ? resolveApiOrigin(url, env.VITE_API_MODE !== 'local') : undefined;
  if (url && !content && env.VITE_API_MODE !== 'local' && !origin?.startsWith('https://')) {
    throw new Error('Production API origin must use HTTPS.');
  }
  return {
    plugins: [
      ...(content ? [tailwindcss()] : [{
        name: 'aurora-api-permission',
        closeBundle() {
          const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8')) as Record<string, unknown>;
          // Chrome match patterns cannot specify a port; restrict scheme and host.
          if (origin) {
            const api = new URL(origin);
            manifest.host_permissions = [`${api.protocol}//${api.hostname}/*`];
          }
          else delete manifest.host_permissions;
          writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
        }
      }])
    ],
    // Library builds retain Node-style environment checks from React unless replaced explicitly.
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      ...(content ? {
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(origin ?? ''),
        'import.meta.env.VITE_TRANSLATION_LANGUAGES': JSON.stringify(env.VITE_TRANSLATION_LANGUAGES ?? '')
      } : {})
    },
    // Both build passes use the same explicit configuration, never an implicit host grant.
    envDir: process.cwd(),
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
