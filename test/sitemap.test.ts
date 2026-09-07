import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRoutesFromDir, fileToRoute, generateSitemap } from '../src/sitemap/generate.js';
import { buildRobotsTxt, buildSitemapIndexXml, buildUrlSetXml, escapeXml } from '../src/sitemap/xml.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-kit-sitemap-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 构造一个产物目录 */
function createOutDir(name: string, routes: string[]) {
  const dir = path.join(tmpDir, name);
  for (const route of routes) {
    const file = route.endsWith('.html') ? path.join(dir, route) : path.join(dir, route, 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<html></html>');
  }
  return dir;
}

describe('xml', () => {
  it('escapeXml 应转义 XML 特殊字符', () => {
    expect(escapeXml('https://a.com/?a=1&b=2')).toBe('https://a.com/?a=1&amp;b=2');
    expect(escapeXml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });

  it('buildUrlSetXml 应输出标准结构并包含 hreflang', () => {
    const xml = buildUrlSetXml([
      {
        loc: 'https://a.com/zh/about',
        lastmod: '2026-01-01',
        changefreq: 'weekly',
        priority: 0.8,
        alternates: [
          { hreflang: 'zh', href: 'https://a.com/zh/about' },
          { hreflang: 'x-default', href: 'https://a.com/about' },
        ],
      },
    ]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain('<loc>https://a.com/zh/about</loc>');
    expect(xml).toContain('<priority>0.8</priority>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://a.com/about"/>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('buildSitemapIndexXml 与 buildRobotsTxt 应输出正确内容', () => {
    expect(buildSitemapIndexXml([{ loc: 'https://a.com/sitemap-1.xml', lastmod: '2026-01-01' }])).toContain('<sitemapindex');
    expect(buildRobotsTxt()).toBe('User-agent: *\nAllow: /\n');
    expect(buildRobotsTxt({ sitemaps: ['https://a.com/sitemap.xml'], rules: [{ userAgent: '*', disallow: ['/admin'] }] })).toBe(
      'User-agent: *\nDisallow: /admin\n\nSitemap: https://a.com/sitemap.xml\n',
    );
  });
});

describe('routes 收集', () => {
  it('fileToRoute 应正确推导路由', () => {
    const outDir = '/dist';
    expect(fileToRoute(path.join(outDir, 'index.html'), outDir)).toBe('/');
    expect(fileToRoute(path.join(outDir, 'about', 'index.html'), outDir)).toBe('/about');
    expect(fileToRoute(path.join(outDir, '404.html'), outDir)).toBe('/404.html');
  });

  it('collectRoutesFromDir 应扫描产物目录（排除规则由 generateSitemap 在路由层面处理）', () => {
    const dir = createOutDir('collect', ['/', '/about', '/zh/about', '/admin/user', '/404.html']);
    expect(collectRoutesFromDir(dir).sort()).toEqual(['/', '/404.html', '/about', '/admin/user', '/zh/about']);
  });
});

describe('generateSitemap', () => {
  it('缺少 siteUrl 时应跳过生成', () => {
    const result = generateSitemap({ routes: ['/'], outDir: tmpDir, logger: false });
    expect(result.urls).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('应生成完整字段并支持多语言 hreflang', () => {
    const outFile = path.join(tmpDir, 'basic-sitemap.xml');
    const result = generateSitemap({
      siteUrl: 'https://example.com',
      routes: ['/', '/zh/about', '/en/about'],
      languages: ['zh', 'en'],
      outFile,
      logger: false,
      priority: { '/': 1, '/about': 0.8 },
      changeFreq: { '/': 'daily' },
      lastmod: '2026-01-01',
    });

    expect(result.urls).toBe(3);
    const xml = fs.readFileSync(outFile, 'utf8');

    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).toContain('<priority>1.0</priority>');
    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>');
    // /zh/about 与 /en/about 互为候选，并带 x-default
    expect(xml).toContain('hreflang="zh" href="https://example.com/zh/about"');
    expect(xml).toContain('hreflang="en" href="https://example.com/en/about"');
    expect(xml).toContain('hreflang="x-default" href="https://example.com/about"');
    // 多语言站点下，优先级按「基础路由」配置生效（无需为每种语言重复配置）
    expect(xml.match(/<priority>0\.8<\/priority>/g)?.length).toBe(2);
  });

  it('未出现语言前缀的路由也应输出 x-default 与全部语言候选', () => {
    const outFile = path.join(tmpDir, 'root-sitemap.xml');
    generateSitemap({ siteUrl: 'https://example.com', routes: ['/'], languages: ['zh', 'en'], outFile, logger: false });

    const xml = fs.readFileSync(outFile, 'utf8');
    expect(xml).toContain('hreflang="zh" href="https://example.com/zh"');
    expect(xml).toContain('hreflang="x-default" href="https://example.com/"');
  });

  it('lastmod 默认取产物文件的修改时间', () => {
    const dir = createOutDir('lastmod', ['/about']);
    const file = path.join(dir, 'about', 'index.html');
    // 设置为 10 天前
    const time = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    fs.utimesSync(file, time, time);

    const outFile = path.join(tmpDir, 'lastmod-sitemap.xml');
    generateSitemap({ siteUrl: 'https://example.com', outDir: dir, outFile, logger: false });

    const xml = fs.readFileSync(outFile, 'utf8');
    expect(xml).toContain(`<lastmod>${time.toISOString().split('T')[0]}</lastmod>`);
  });

  it('应支持 base 子路径、exclude、robots 与 gzip', () => {
    const dir = createOutDir('full', ['/', '/about', '/admin/user']);
    const outFile = path.join(dir, 'sitemap.xml');

    const result = generateSitemap({
      siteUrl: 'https://example.com/',
      base: '/app',
      outDir: dir,
      outFile,
      exclude: ['/admin'],
      robots: { rules: [{ userAgent: '*', disallow: ['/admin'] }] },
      gzip: true,
      logger: false,
    });

    expect(result.urls).toBe(2);
    const xml = fs.readFileSync(outFile, 'utf8');
    expect(xml).toContain('<loc>https://example.com/app/</loc>');
    expect(xml).toContain('<loc>https://example.com/app/about</loc>');
    expect(xml).not.toContain('/admin');
    expect(fs.existsSync(`${outFile}.gz`)).toBe(true);

    const robots = fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Sitemap: https://example.com/app/sitemap.xml');
  });

  it('URL 数超过阈值时应拆分为多个 sitemap 并生成 index', () => {
    const dir = createOutDir('split', ['/a', '/b', '/c', '/d']);
    const outFile = path.join(tmpDir, 'split-sitemap.xml');

    const result = generateSitemap({
      siteUrl: 'https://example.com',
      outDir: dir,
      outFile,
      maxUrlsPerFile: 2,
      logger: false,
    });

    expect(result.urls).toBe(4);
    expect(result.files.length).toBe(2);
    expect(result.index).toBe(outFile);
    expect(fs.readFileSync(outFile, 'utf8')).toContain('<sitemapindex');
    expect(fs.readFileSync(result.files[0], 'utf8')).toContain('<urlset');
  });

  it('URL 中的特殊字符应被转义', () => {
    const outFile = path.join(tmpDir, 'escape-sitemap.xml');
    generateSitemap({
      siteUrl: 'https://example.com',
      routes: ['/search?q=a&b=1'],
      outFile,
      logger: false,
    });

    const xml = fs.readFileSync(outFile, 'utf8');
    expect(xml).toContain('<loc>https://example.com/search?q=a&amp;b=1</loc>');
  });
});
