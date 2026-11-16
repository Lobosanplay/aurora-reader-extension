import { Readability } from '@mozilla/readability';
import { chunkText, normalizeText } from '../utils/chunk-text';
import type { PageContent } from '../types';

const excluded = 'script,style,noscript,nav,header,footer,aside,form,input,textarea,select,button,[contenteditable], [hidden], [aria-hidden="true"], [role="navigation"], [role="banner"], [role="complementary"], .ad, .ads, .advertisement, #aurora-reader-host';
const blocks = 'h1,h2,h3,h4,p,li,blockquote,pre';

function visibleCopy(doc: Document): Document {
  const copy = doc.cloneNode(true) as Document;
  const original = [doc.documentElement, ...doc.documentElement.querySelectorAll('*')];
  const cloned = [copy.documentElement, ...copy.documentElement.querySelectorAll('*')];
  const view = doc.defaultView;
  const removed: Element[] = [];
  original.forEach((node, index) => {
    if (node === doc.documentElement) return;
    const style = view?.getComputedStyle(node);
    if (node.matches(excluded) || node.hasAttribute('inert') ||
        style?.display === 'none' || style?.visibility === 'hidden' ||
        style?.visibility === 'collapse' || style?.contentVisibility === 'hidden' ||
        style?.opacity === '0') {
      removed.push(cloned[index]);
    }
  });
  removed.forEach((node) => node.remove());
  return copy;
}

function clean(root: Element): void {
  root.querySelectorAll(excluded).forEach((node) => node.remove());
}

function collect(root: Element): string[] {
  return Array.from(root.querySelectorAll(blocks))
    .filter((node) => !node.closest(blocks.split(',').filter((tag) => tag !== node.tagName.toLowerCase()).join(',')))
    .map((node) => normalizeText(node.textContent ?? ''))
    .filter(Boolean);
}

export function extractPage(doc: Document = document): PageContent {
  if (!/^https?:$/i.test(doc.location.protocol) || doc.contentType !== 'text/html') {
    throw new Error('This page is not a supported HTML document.');
  }
  const copy = visibleCopy(doc);
  const fallbackRoot = copy.querySelector('article, main, [role="main"]');
  const article = new Readability(copy.cloneNode(true) as Document).parse();
  let paragraphs: string[] = [];
  if (article?.content) {
    const container = doc.createElement('div');
    container.innerHTML = article.content; // Parsing only; never rendered into the widget.
    clean(container);
    paragraphs = collect(container);
  }
  if (paragraphs.join(' ').length < 120 && fallbackRoot) paragraphs = collect(fallbackRoot);
  const chunks = chunkText(paragraphs);
  if (chunks.map((chunk) => chunk.originalText).join('').length < 80) {
    throw new Error('No readable article found. Try an article page with substantial text.');
  }
  return {
    url: doc.location.href,
    title: normalizeText(article?.title || doc.title) || 'Untitled page',
    language: doc.documentElement.lang?.trim() || null,
    chunks
  };
}
