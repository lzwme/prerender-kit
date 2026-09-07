import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findHtmlFiles, optimizeHtmlFiles } from '../src/optimize/files.js';
import {
  addLoadingIndicator,
  minifyHtml,
  optimizeHtml,
  preserveTagBlocks,
  removeClassAttributes,
  removeInlineStyles,
  removeInlineSvg,
} from '../src/optimize/html.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-kit-optimize-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('preserveTagBlocks', () => {
  it('应保护 script/style 内容并在 restore 后还原', () => {
    const html = `<div class="a">x</div><script>var s = 'class="keep"';</script>`;
    const { html: working, restore } = preserveTagBlocks(html, ['script', 'style'], { placeholderPrefix: '___P_' });

    expect(working).toContain('___P_0___');
    expect(working).not.toContain('class="keep"');
    expect(restore(working.replace(/\sclass="[^"]*"/g, ''))).toBe(html.replace(/\sclass="[^"]*"/g, ''));
  });

  it('占位符与正文冲突时应自动加长前缀', () => {
    const html = `<div>___P_0___</div><script>var a = 1;</script>`;
    const { html: working } = preserveTagBlocks(html, ['script'], { placeholderPrefix: '___P_' });
    expect(working).toContain('___P_0___</div>');
    expect(working).toMatch(/_{4,}P_0___$/);
  });

  it('tags 为空时原样返回', () => {
    const { html, restore } = preserveTagBlocks('<div>x</div>', []);
    expect(html).toBe('<div>x</div>');
    expect(restore(html)).toBe('<div>x</div>');
  });
});

describe('单项优化能力', () => {
  it('removeInlineSvg 应移除 svg 并计数', () => {
    const html = '<div><svg viewBox="0 0 1 1"><path d="M0"/></svg></div><span>x</span>';
    const { html: result, count } = removeInlineSvg(html);
    expect(count).toBe(1);
    expect(result).toBe('<div></div><span>x</span>');
    expect(removeInlineSvg('<div>x</div>').count).toBe(0);
  });

  it('removeInlineSvg 的 removeEmptyWrappers 默认关闭，开启后只清理成对的空包裹层', () => {
    const html = '<p><div><div><svg></svg></div></div></p>';
    expect(removeInlineSvg(html).html).toBe('<p><div><div></div></div></p>');
    expect(removeInlineSvg(html, { removeEmptyWrappers: true }).html).toBe('<p></p>');
    // 内部仍有内容时不应被清理
    const keep = '<div><div><svg></svg><span>x</span></div></div>';
    expect(removeInlineSvg(keep, { removeEmptyWrappers: true }).html).toBe('<div><div><span>x</span></div></div>');
  });

  it('removeInlineStyles 应按长度阈值移除大段样式', () => {
    const big = `<style>${'a{color:red}'.repeat(100)}</style>`;
    const small = '<style>.critical{display:block}</style>';

    const result = removeInlineStyles(big + small, 1000);
    expect(result.count).toBe(1);
    expect(result.html).toBe(small);

    // 阈值 0 时移除全部
    expect(removeInlineStyles(big + small, 0).count).toBe(2);
    expect(removeInlineStyles(small, 1000).count).toBe(0);
  });

  it('removeClassAttributes 不应误伤 script 内的字符串', () => {
    const html = `<div class="a b">x</div><script>const t = '<i class="inner">';</script>`;
    const { html: result, count } = removeClassAttributes(html);
    expect(count).toBe(1);
    expect(result).toBe('<div>x</div><script>const t = \'<i class="inner">\';</script>');
  });

  it('minifyHtml 应移除注释与多余空白，但保护 pre/textarea', () => {
    const html = `<div>  <span> a </span>  </div><!-- note --><pre>  keep  </pre>`;
    const result = minifyHtml(html);
    expect(result).not.toContain('note');
    expect(result).toContain('<div><span> a </span></div>');
    expect(result).toContain('<pre>  keep  </pre>');
  });

  it('addLoadingIndicator 应在挂载点后注入，且挂载点不存在时原样返回', () => {
    const html = '<div id="app"></div>';
    expect(addLoadingIndicator(html)).toContain('@keyframes p');
    expect(addLoadingIndicator('<div id="root"></div>')).toBe('<div id="root"></div>');
    expect(addLoadingIndicator(html, { target: '<div id="app">', html: '<!--loading-->' })).toBe('<div id="app"><!--loading--></div>');
  });
});

describe('optimizeHtml', () => {
  const html = [
    '<html>',
    '<head><style>a{color:red}</style></head>',
    '<body>',
    '<div id="app">',
    '<div class="card"><svg viewBox="0 0 1 1"><path d="M0"/></svg></div>',
    '</div>',
    '<!-- comment -->',
    '<script type="module" src="/assets/index.js"></script>',
    '</body></html>',
  ].join('\n');

  it('全部开关关闭时应原样返回', () => {
    const { html: result, stats } = optimizeHtml(html, {});
    expect(result).toBe(html);
    expect(stats.svgRemoved).toBe(0);
    expect(stats.sizeAfter).toBe(stats.sizeBefore);
  });

  it('开启全部开关后应移除 svg/class、压缩空白', () => {
    const { html: result, stats } = optimizeHtml(html, {
      removeInlineSvg: true,
      removeClassAttributes: true,
      minify: true,
      removeInlineStyles: true,
      inlineStylesMinLength: 0,
    });

    expect(stats.svgRemoved).toBe(1);
    expect(stats.classAttributesRemoved).toBe(1);
    expect(stats.inlineStylesRemoved).toBe(1);
    expect(stats.sizeAfter).toBeLessThan(stats.sizeBefore);
    expect(result).not.toContain('<svg');
    expect(result).not.toContain('class="card"');
    expect(result).not.toContain('comment');
    // 脚本引用必须保留
    expect(result).toContain('/assets/index.js');
  });

  it('loadingIndicator 开启时才注入', () => {
    expect(optimizeHtml(html, { minify: true }).html).not.toContain('@keyframes p');
    expect(optimizeHtml(html, { loadingIndicator: true }).html).toContain('@keyframes p');
  });
});

describe('optimizeHtmlFiles', () => {
  it('应批量处理目录下的 html 并支持 exclude 与仅写入变小的文件', () => {
    const dir = path.join(tmpDir, 'site');
    fs.mkdirSync(path.join(dir, 'about'), { recursive: true });
    const html = '<html><body><div class="a">   x   </div><svg></svg><!-- c --></body></html>';
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    fs.writeFileSync(path.join(dir, 'about', 'index.html'), html);
    fs.writeFileSync(path.join(dir, 'keep.html'), html);

    const files = findHtmlFiles(dir);
    expect(files.length).toBe(3);
    expect(findHtmlFiles(dir, ['/about/']).length).toBe(2);

    const stats = optimizeHtmlFiles({
      dir,
      exclude: ['keep.html'],
      removeClassAttributes: true,
      removeInlineSvg: true,
      minify: true,
      logger: false,
    });

    expect(stats.files).toBe(2);
    expect(stats.sizeAfter).toBeLessThan(stats.sizeBefore);
    // 压缩仅处理标签之间的空白，文本节点内部的空白保持不变（避免影响语义）
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<html><body><div> x </div></body></html>');
    // 被排除的文件保持原样
    expect(fs.readFileSync(path.join(dir, 'keep.html'), 'utf8')).toBe(html);
  });

  it('目录不存在时应返回空统计', () => {
    const stats = optimizeHtmlFiles({ dir: path.join(tmpDir, 'not-exists'), logger: false });
    expect(stats.files).toBe(0);
  });
});
