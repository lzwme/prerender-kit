import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prerenderer, resolveOptions } from '../src/core/prerenderer.js';
import { createStaticServer } from '../src/core/static-server.js';
import type { PrerenderOptions, Renderer, StaticServer } from '../src/types.js';

const INDEX_HTML =
  '<html><head><style>.a{color:red}</style></head><body><div id="app"></div><script>document.title = location.pathname</script></body></html>';

let rootDir = '';
let server: StaticServer | null = null;

/** 真实发起请求并返回 HTML 的渲染器，用于验证静态服务与产物写入链路（无需 puppeteer） */
function createFetchRenderer(): Renderer {
  return {
    name: 'fetch-mock',
    async launch() {},
    async render(url: string) {
      const html = await (await fetch(url)).text();
      // 插入当前访问地址，用于验证本地地址会被清理
      return html.replace('</body>', `<a href="${url}"></a></body>`);
    },
    async close() {},
  };
}

/** 创建一个带 index.html 的站点目录 */
function createSiteDir(name: string): string {
  const dir = path.join(rootDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  return dir;
}

beforeAll(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-kit-e2e-'));
  server = await createStaticServer({ root: createSiteDir('site') });
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('resolveOptions', () => {
  it('缺少必填项时应抛出错误', () => {
    expect(() => resolveOptions({} as PrerenderOptions)).toThrow(/routes/);
    expect(() => resolveOptions({ routes: ['/'] } as PrerenderOptions)).toThrow(/outDir/);
  });

  it('应填充默认值', () => {
    const options = resolveOptions({ routes: ['/'], outDir: 'dist' });
    expect(options.base).toBe('/');
    expect(options.concurrency).toBe(5);
    expect(options.maxAge).toBe(60);
    expect(options.waitForSelector).toBe('body');
    expect(options.outDir).toBe(path.resolve('dist'));
  });
});

describe('Prerenderer', () => {
  it('应渲染产物并写入 <outDir>/<route>/index.html', async () => {
    const outDir = path.join(rootDir, 'out-basic');
    const result = await new Prerenderer({
      routes: ['/', '/about'],
      outDir,
      baseUrl: server?.url,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.rendered).toEqual(['/', '/about']);
    expect(result.failed).toEqual([]);
    expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'about', 'index.html'))).toBe(true);

    const content = fs.readFileSync(path.join(outDir, 'about', 'index.html'), 'utf8');
    expect(content).toContain('<div id="app">');
    // 内联 style 与本地服务地址均应被清理
    expect(content).not.toContain('<style>');
    expect(content).not.toContain('127.0.0.1');
  });

  it('removeBaseUrl 为 false 时应保留站点绝对地址', async () => {
    const outDir = path.join(rootDir, 'out-keep-url');
    await new Prerenderer({
      routes: ['/'],
      outDir,
      baseUrl: server?.url,
      removeBaseUrl: false,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')).toContain('127.0.0.1');
  });

  it('应跳过仍在有效期内的产物，并支持 force 强制重渲染', async () => {
    const outDir = path.join(rootDir, 'out-incremental');
    const base: PrerenderOptions = {
      routes: ['/', '/about'],
      outDir,
      baseUrl: server?.url,
      renderer: createFetchRenderer(),
      logger: false,
    };

    const first = await new Prerenderer(base).render();
    expect(first.rendered.length).toBe(2);

    const second = await new Prerenderer(base).render();
    expect(second.rendered).toEqual([]);
    expect(second.skipped).toEqual(['/', '/about']);

    const third = await new Prerenderer({ ...base, force: true }).render();
    expect(third.rendered.length).toBe(2);
    expect(third.skipped).toEqual([]);
  });

  it('未配置 baseUrl 时应自动启动内置静态服务', async () => {
    const staticDir = createSiteDir('site-auto');
    const outDir = path.join(rootDir, 'out-auto');

    const result = await new Prerenderer({
      routes: ['/'],
      outDir,
      staticDir,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.rendered).toEqual(['/']);
    expect(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')).toContain('<div id="app">');
  });

  it('单个路由失败不应影响其它路由', async () => {
    const outDir = path.join(rootDir, 'out-failed');
    const result = await new Prerenderer({
      routes: ['/', '/error'],
      outDir,
      baseUrl: server?.url,
      logger: false,
      renderer: {
        name: 'mock-error',
        async launch() {},
        async render(url: string) {
          if (url.endsWith('/error')) throw new Error('render error');
          return '<html><body>ok</body></html>';
        },
        async close() {},
      },
    }).render();

    expect(result.rendered).toEqual(['/']);
    expect(result.failed).toEqual(['/error']);
  });

  it('discoverLinks 开启时应自动发现并渲染站内链接', async () => {
    const siteDir = path.join(rootDir, 'site-crawl');
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(
      path.join(siteDir, 'index.html'),
      '<html><body><a href="/about">about</a><a href="https://other.com/x">ext</a><a href="/deep/page">deep</a></body></html>',
    );

    const outDir = path.join(rootDir, 'out-crawl');
    const result = await new Prerenderer({
      routes: ['/'],
      outDir,
      staticDir: siteDir,
      discoverLinks: true,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.discovered.sort()).toEqual(['/about', '/deep/page']);
    expect(result.rendered.sort()).toEqual(['/', '/about', '/deep/page']);
    expect(result.total).toBe(3);
  });

  it('maxRoutes 应限制自动发现的路由总数', async () => {
    const siteDir = path.join(rootDir, 'site-max');
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<html><body><a href="/a">a</a><a href="/b">b</a></body></html>');

    const result = await new Prerenderer({
      routes: ['/'],
      outDir: path.join(rootDir, 'out-max'),
      staticDir: siteDir,
      discoverLinks: true,
      maxRoutes: 2,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.total).toBe(2);
    expect(result.rendered.length).toBe(2);
  });

  it('应收集页面运行时错误，failOnPageError 时视为失败', async () => {
    const outDir = path.join(rootDir, 'out-errors');
    const errorRenderer = (): Renderer => ({
      name: 'error-collector',
      errors: [] as string[],
      async launch() {},
      async render() {
        this.errors.push('Uncaught TypeError: xxx');
        return '<html><body>ok</body></html>';
      },
      drainErrors() {
        const current = this.errors;
        this.errors = [];
        return current;
      },
      async close() {},
    });

    const warned = await new Prerenderer({
      routes: ['/'],
      outDir,
      baseUrl: server?.url,
      renderer: errorRenderer(),
      logger: false,
    }).render();
    expect(warned.pageErrors['/']).toEqual(['Uncaught TypeError: xxx']);
    expect(warned.failed).toEqual([]);

    const failed = await new Prerenderer({
      routes: ['/'],
      outDir,
      baseUrl: server?.url,
      force: true,
      failOnPageError: true,
      renderer: errorRenderer(),
      logger: false,
    }).render();
    expect(failed.failed).toEqual(['/']);
    expect(failed.rendered).toEqual([]);
  });

  it('optimize 开启时应对产物执行 HTML 瘦身', async () => {
    const siteDir = path.join(rootDir, 'site-optimize');
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(
      path.join(siteDir, 'index.html'),
      '<html><body><div id="app"><div class="card"><svg viewBox="0 0 1 1"></svg></div></div><!-- note --></body></html>',
    );

    const outDir = path.join(rootDir, 'out-optimize');
    const result = await new Prerenderer({
      routes: ['/'],
      outDir,
      staticDir: siteDir,
      optimize: { removeInlineSvg: true, removeClassAttributes: true, minify: true },
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.optimize?.svgRemoved).toBe(1);
    expect(result.optimize?.classAttributesRemoved).toBe(1);
    expect(result.optimize!.sizeAfter).toBeLessThan(result.optimize!.sizeBefore);

    const content = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(content).not.toContain('<svg');
    expect(content).not.toContain('class="card"');
    expect(content).not.toContain('note');
    // 挂载点与脚本引用应保留
    expect(content).toContain('id="app"');
  });

  it('sitemap 开启时应基于实际产物生成 sitemap', async () => {
    const outDir = path.join(rootDir, 'out-sitemap');
    const result = await new Prerenderer({
      routes: ['/', '/about'],
      outDir,
      baseUrl: server?.url,
      renderer: createFetchRenderer(),
      logger: false,
      sitemap: { siteUrl: 'https://example.com', lastmod: '2026-01-01', robots: true },
    }).render();

    expect(result.sitemap?.urls).toBe(2);
    const xml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).toContain('<loc>https://example.com/about</loc>');
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>');
    expect(fs.existsSync(path.join(outDir, 'robots.txt'))).toBe(true);
  });

  it('sitemap 未开启时不应生成 sitemap 文件', async () => {
    const outDir = path.join(rootDir, 'out-no-sitemap');
    const result = await new Prerenderer({
      routes: ['/'],
      outDir,
      baseUrl: server?.url,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.sitemap).toBeUndefined();
    expect(fs.existsSync(path.join(outDir, 'sitemap.xml'))).toBe(false);
  });

  it('未开启 optimize 时不应改动产物内容', async () => {
    const outDir = path.join(rootDir, 'out-no-optimize');
    const result = await new Prerenderer({
      routes: ['/'],
      outDir,
      baseUrl: server?.url,
      renderer: createFetchRenderer(),
      logger: false,
    }).render();

    expect(result.optimize).toBeUndefined();
    expect(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')).toContain('<div id="app">');
  });

  it('应支持自定义产物路径与非法路由过滤', async () => {
    const outDir = path.join(rootDir, 'out-custom');
    const result = await new Prerenderer({
      routes: ['/about', '/list?page=1'],
      outDir,
      baseUrl: server?.url,
      renderer: createFetchRenderer(),
      logger: false,
      outputFile: (route, dir) => (route.includes('?') ? '' : path.join(dir, `${route.replace(/^\//, '') || 'index'}.html`)),
    }).render();

    expect(result.invalid).toEqual(['/list?page=1']);
    expect(result.rendered).toEqual(['/about']);
    expect(fs.existsSync(path.join(outDir, 'about.html'))).toBe(true);
  });
});
