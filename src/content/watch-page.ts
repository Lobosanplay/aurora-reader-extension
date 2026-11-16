import { normalizeText } from '../utils/chunk-text';

const readingBlocks = 'h1,h2,h3,h4,p,li,blockquote,pre';
const ignored = '#aurora-reader-host,nav,header,footer,aside,form,[hidden],[aria-hidden="true"],[contenteditable]';

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches(ignored) || node.hasAttribute('inert')) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' ||
        style?.visibility === 'collapse' || style?.contentVisibility === 'hidden' ||
        style?.opacity === '0') return false;
  }
  return true;
}

function readingRoot(doc: Document): Element {
  return Array.from(doc.querySelectorAll('article,main,[role="main"]')).find(visible) ??
    doc.body ?? doc.documentElement;
}

function signature(root: Element): string {
  return Array.from(root.querySelectorAll(readingBlocks))
    .filter(visible)
    .map((node) => normalizeText(node.textContent ?? ''))
    .join('\n');
}

export function watchPage(doc: Document, changed: () => void, isMounted: () => boolean = () => true): () => void {
  let url = doc.location.href;
  let root = readingRoot(doc);
  let text = signature(root);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const check = (): void => {
    timer = undefined;
    if (closed) return;
    const nextRoot = readingRoot(doc);
    const nextText = signature(nextRoot);
    const nextUrl = doc.location.href;
    if (nextUrl === url && nextRoot === root && nextText === text) return;
    url = nextUrl;
    root = nextRoot;
    text = nextText;
    changed();
    // Extraction and widget updates are synchronous; retain the post-change baseline.
    root = readingRoot(doc);
    text = signature(root);
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(check, 150);
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      if (!target || target.closest('#aurora-reader-host')) return false;
      return root.contains(target) || (mutation.type === 'attributes' && target.contains(root)) || !root.isConnected ||
        Array.from(mutation.removedNodes).some((node) => node === root || node.contains?.(root));
    })) schedule();
  });
  observer.observe(doc.documentElement, {
    childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert'], subtree: true
  });
  const interval = setInterval(() => {
    if (!isMounted()) { changed(); return; }
    if (doc.location.href !== url || !root.isConnected) check();
  }, 500);
  return () => {
    closed = true;
    observer.disconnect();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}
