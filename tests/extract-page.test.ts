import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/content/extract-page';

describe('page extraction', () => {
  it('extracts article text without form or navigation content', () => {
    document.body.innerHTML = `<nav>Navigation links should not be read</nav><main>
      <h1>An article</h1><p>${'Readable paragraph with complete sentences. '.repeat(6)}</p>
      <form><input type="password" value="secret"><p>Private form text</p></form>
      <p>Final paragraph with more readable prose to close this article.</p></main>`;
    document.documentElement.lang = 'en';
    const result = extractPage(document);
    const text = result.chunks.map((chunk) => chunk.originalText).join(' ');
    expect(result.language).toBe('en');
    expect(text).toContain('Readable paragraph');
    expect(text).toContain('Final paragraph');
    expect(text).not.toContain('Navigation links');
    expect(text).not.toContain('Private form');
    expect(text).not.toContain('secret');
  });
  it('fails safely for short pages', () => {
    document.body.innerHTML = '<main><p>Short.</p></main>';
    expect(() => extractPage(document)).toThrow(/No readable article/);
  });
  it('excludes CSS-hidden subtrees, inputs, editable content and the widget without changing the page', () => {
    document.head.innerHTML = '<style>.private { display:none } .invisible { visibility:hidden }</style>';
    document.body.innerHTML = `<main><h1>Public article</h1>
      <p>${'Visible opening paragraph. '.repeat(8)}</p>
      <section class="private"><p>${'CSS secret. '.repeat(15)}</p></section>
      <div class="invisible"><p>${'Invisible secret. '.repeat(15)}</p></div>
      <section hidden><p>Hidden attribute secret.</p></section>
      <div style="display:none"><p>Inline secret.</p></div>
      <div style="opacity:0"><p>Transparent secret.</p></div>
      <div contenteditable="true"><p>Editable secret.</p></div>
      <form><input value="Password"><p>Form secret.</p></form>
      <p>${'Visible closing paragraph. '.repeat(8)}</p></main>
      <div id="aurora-reader-host"><p>Widget secret.</p></div>`;
    const before = document.body.innerHTML;
    const text = extractPage(document).chunks.map((chunk) => chunk.originalText).join(' ');
    expect(text).toContain('Visible opening paragraph');
    expect(text).toContain('Visible closing paragraph');
    expect(text.indexOf('Visible opening')).toBeLessThan(text.indexOf('Visible closing'));
    for (const secret of ['CSS secret', 'Invisible secret', 'Hidden attribute secret',
      'Inline secret', 'Transparent secret', 'Editable secret', 'Form secret', 'Widget secret', 'Password']) {
      expect(text).not.toContain(secret);
    }
    expect(document.body.innerHTML).toBe(before);
  });
});
