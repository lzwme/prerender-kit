import { describe, expect, it } from 'vitest';
import { extractLinks } from '../src/core/links.js';

describe('extractLinks', () => {
  it('应提取站内链接并忽略外链/锚点/下载链接', () => {
    const html = `
      <a href="/foo">foo</a>
      <a href="/bar/">bar</a>
      <a href="https://example.com/x">external</a>
      <a href="mailto:a@b.com">mail</a>
      <a href="#anchor">anchor</a>
      <a href="/baz" download>download</a>
      <a href="/qux" target="_blank">new tab</a>
      <a href="/quux" target="_self">self</a>
    `;
    expect(extractLinks(html)).toEqual(['/foo', '/bar', '/quux']);
  });

  it('应与站点同源时保留绝对地址，并剥离 query 与 hash', () => {
    const html = `<a href="http://127.0.0.1:3000/about?a=1#top">about</a>`;
    expect(extractLinks(html, { baseUrl: 'http://127.0.0.1:3000' })).toEqual(['/about']);
    // 未提供 baseUrl 时，绝对地址不被认为是站内链接
    expect(extractLinks(html)).toEqual([]);
  });

  it('应保留 .html 结尾的路由', () => {
    expect(extractLinks(`<a href="/404.html">404</a>`)).toEqual(['/404.html']);
  });

  it('应支持自定义过滤', () => {
    const html = `<a href="/a">a</a><a href="/admin/b">admin</a>`;
    expect(extractLinks(html, { filter: (url) => !url.startsWith('/admin') })).toEqual(['/a']);
  });
});
