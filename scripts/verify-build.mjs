import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== 'background.js') {
  throw new Error('MV3 manifest does not point to the built service worker.');
}
for (const file of ['background.js', 'content.js']) {
  if (!existsSync(`dist/${file}`)) throw new Error(`Missing extension entrypoint: ${file}`);
}

const bundle = readFileSync('dist/content.js', 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.com/article',
  runScripts: 'outside-only'
});
let listener;
dom.window.chrome = {
  runtime: {
    id: 'aurora-build-check',
    onMessage: { addListener: (callback) => { listener = callback; } }
  }
};
try {
  dom.window.eval(bundle);
  if (!listener) throw new Error('Content script did not register its message listener.');
  let response;
  listener({ action: 'OPEN_AURORA' }, { id: 'aurora-build-check' }, (result) => { response = result; });
  if (response?.status !== 'opened') throw new Error('Content script did not acknowledge successful activation.');
  if (!dom.window.document.getElementById('aurora-reader-host')) {
    throw new Error('Open message did not mount the widget host.');
  }
  listener({ action: 'OPEN_AURORA' }, { id: 'aurora-build-check' }, (result) => { response = result; });
  if (response?.status !== 'opened' || dom.window.document.querySelectorAll('#aurora-reader-host').length !== 1) {
    throw new Error('Repeated activation created a duplicate widget.');
  }
  Object.defineProperty(dom.window.document, 'contentType', { configurable: true, value: 'application/pdf' });
  listener({ action: 'OPEN_AURORA' }, { id: 'aurora-build-check' }, (result) => { response = result; });
  if (response?.status !== 'unsupported') {
    throw new Error('Non-HTML documents did not receive explicit unsupported feedback.');
  }
} finally {
  dom.window.close();
}
console.log('Verified MV3 entrypoints and content-script startup without Node process globals.');
