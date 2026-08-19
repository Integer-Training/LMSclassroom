import 'dotenv/config';

import adapterNode from '@sveltejs/adapter-node';
import { getCspDomains } from './src/lib/utils/csp-domains.js';
import path from 'path';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const IS_CLOUDFLARE = process.env.CI_ENVIRONMENT === 'cloudflare';

const adapterCloudflare = IS_CLOUDFLARE ? (await import('@sveltejs/adapter-cloudflare')).default : null;
const isSelfHosted = process.env.PUBLIC_IS_SELFHOSTED === 'true';
const csp = getCspDomains(isSelfHosted, process.env.PUBLIC_SERVER_URL);

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],
  kit: {
    // Default: Node server (Render, Docker). Opt into Cloudflare Pages only when CI_ENVIRONMENT=cloudflare.
    adapter: IS_CLOUDFLARE ? adapterCloudflare() : adapterNode(),
    alias: {
      $lib: path.resolve('./src/lib'),
      $features: path.resolve('./src/lib/features'),
      $mail: path.resolve('./src/mail'),
      '$src/tools': path.resolve('./node_modules/@cio/ui/src/tools/index.ts'),
      '$src/base/*': path.resolve('./node_modules/@cio/ui/src/base/*'),
      '@cio/ui': path.resolve('./node_modules/@cio/ui/src'),
      '@cio/ui/*': path.resolve('./node_modules/@cio/ui/src/*'),
      '@cio/api': path.resolve('./node_modules/@cio/api/dist'),
      '@cio/api/*': path.resolve('./node_modules/@cio/api/dist/*'),
      '@cio/utils': path.resolve('./node_modules/@cio/utils/dist'),
      '@cio/utils/*': path.resolve('./node_modules/@cio/utils/dist/*'),
      '@cio/db/types': path.resolve('./node_modules/@cio/db/src/types.ts')
    },
    // PearlLMS Phase-10 HP/SA-1b — honest CSP. Self-hosted starts from EMPTY external allow-lists
    // (getCspDomains → all []), so the baseline is `default-src 'self'` with `object-src 'none'`, `base-uri
    // 'self'`, `form-action 'self'`, `frame-ancestors 'self'` — a real control, NOT an all-`unsafe-*` policy.
    // Operators add ONLY the hosts they actually use (INTEGRATIONS.md M1 video embeds → CSP_FRAME_SRC_DOMAINS,
    // Supabase storage → CSP_CONNECT/MEDIA_SRC_DOMAINS) at runtime via hooks.server.ts. Residual unsafe tokens:
    //   • script 'unsafe-eval' — required by a bundled dependency (PDF.js worker font/CMap parsing). The
    //     report-only policy below DROPS it as a live canary so a console click-through shows what still needs
    //     it before we remove it from the enforced policy.
    //   • style 'unsafe-inline' — forced by Svelte's scoped-style + dynamic `style=` injection (not removable
    //     without nonce plumbing the framework doesn't emit); documented, framework-inherent.
    // 'unsafe-hashes' (inline on*= handlers) was REMOVED — the SvelteKit build binds via addEventListener.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', ...csp.scriptSrc, 'unsafe-eval'],
        'style-src': ['self', 'unsafe-inline', ...csp.styleSrc],
        'style-src-elem': ['self', 'unsafe-inline', ...csp.styleSrc],
        // data: covers inlined woff2 (e.g. PDF.js / icon fonts); file fonts use 'self'
        'font-src': ['self', 'data:', ...csp.fontSrc],
        'img-src': ['self', 'data:', ...csp.mediaSrc, 'blob:', 'http://localhost:9000'],
        'media-src': [
          'self',
          ...csp.mediaSrc,
          'data:',
          'blob:',
          'http://localhost:9000',
          ...(csp.apiOrigin ? [csp.apiOrigin] : [])
        ],
        'frame-src': ['self', ...csp.frameSrc],
        'connect-src': [
          'self',
          'blob:',
          'http://localhost:3002',
          'http://localhost:9000',
          ...(csp.apiOrigin ? [csp.apiOrigin] : []),
          ...csp.connectSrc
        ],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        // 'self' allows same-origin iframes (e.g. widget preview at /widget-preview). 'none' blocks all embedding.
        'frame-ancestors': ['self'],
        'upgrade-insecure-requests': true
      },
      // HP/SA-1b canary — STRICTER than enforced: script-src has NO 'unsafe-eval'/'unsafe-hashes'. Violations
      // report to /csp-report (and show in the console during the click-through) so we gather evidence of what
      // still needs eval before tightening the enforced policy. Report-only never blocks, so this is safe to run.
      reportOnly: {
        'default-src': ['self'],
        'script-src': ['self', ...csp.scriptSrc],
        'style-src': ['self', 'unsafe-inline', ...csp.styleSrc],
        'style-src-elem': ['self', 'unsafe-inline', ...csp.styleSrc],
        'font-src': ['self', 'data:', ...csp.fontSrc],
        'img-src': ['self', 'data:', ...csp.mediaSrc, 'blob:', 'http://localhost:9000'],
        'media-src': [
          'self',
          ...csp.mediaSrc,
          'data:',
          'blob:',
          'http://localhost:9000',
          ...(csp.apiOrigin ? [csp.apiOrigin] : [])
        ],
        'frame-src': ['self', ...csp.frameSrc],
        'connect-src': [
          'self',
          'blob:',
          'http://localhost:3002',
          'http://localhost:9000',
          ...(csp.apiOrigin ? [csp.apiOrigin] : []),
          ...csp.connectSrc
        ],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'frame-ancestors': ['self'],
        'report-uri': ['/csp-report']
      }
    }
  }
};

export default config;
