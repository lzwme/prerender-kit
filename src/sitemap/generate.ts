import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { defaultOutputFile, normalizeRoute } from '../core/routes.js';
import { findHtmlFiles } from '../optimize/files.js';
import type { RobotsOptions, SitemapOptions, SitemapResult, SitemapUrlEntry } from '../types.js';
import { isExcluded } from '../utils/filter.js';
import { resolveLogger } from '../utils/logger.js';
import { buildRobotsTxt, buildSitemapIndexXml, buildUrlSetXml } from './xml.js';

/** sitemap 协议建议的单个文件 URL 上限(5 万)，留出余量 */
const DEFAULT_MAX_URLS_PER_FILE = 45000;

/** 从产物文件路径推导路由：about/index.html -> /about，index.html -> /，404.html -> /404.html */
export function fileToRoute(file: string, outDir: string): string {
  const relative = path.relative(outDir, file).replace(/\\/g, '/');
  let route = relative.replace(/index\.html$/i, '');
  if (!route.endsWith('.html')) route = route.replace(/\/$/, '');
  return normalizeRoute(route) || '/';
}

/**
 * 扫描产物目录，得到所有已预渲染的路由。
 * 注意：排除规则由调用方在「路由」层面处理，这里不做过滤，
 * 避免形如 /\.html$/ 的规则在文件层面误杀全部产物
 */
export function collectRoutesFromDir(outDir: string): string[] {
  return findHtmlFiles(outDir).map((file) => fileToRoute(file, outDir));
}

/** 拼接完整访问地址 */
function toUrl(siteUrl: string, base: string, route: string): string {
  return `${siteUrl}${base}${route}`;
}

/** 归一化 base：/ 或空 -> ''，/sub/ -> /sub */
function normalizeBase(base?: string): string {
  const value = `/${(base || '').replace(/^\/+|\/+$/g, '')}`;
  return value === '/' ? '' : value;
}

/** 识别路由所属语言，返回语言与去掉语言前缀后的基础路由 */
function detectLanguage(route: string, languages: string[]): { lang?: string; baseRoute: string } {
  for (const lang of languages) {
    if (route === `/${lang}`) return { lang, baseRoute: '/' };
    if (route.startsWith(`/${lang}/`)) return { lang, baseRoute: route.slice(lang.length + 1) || '/' };
  }
  return { baseRoute: route };
}

/** 按语言生成对应路由 */
function toLanguageRoute(route: string, lang: string, mode: SitemapOptions['languageRoute'] = 'prefix'): string {
  if (typeof mode === 'function') return normalizeRoute(mode(route, lang)) || '/';
  if (mode === 'suffix') return normalizeRoute(`${route.replace(/\/$/, '')}-${lang}`) || `/${lang}`;
  return route === '/' ? `/${lang}` : `/${lang}${route}`;
}

/** 按「基础路由优先、完整路由兜底」的规则解析值 */
function resolveRule<T>(route: string, baseRoute: string, rule?: Record<string, T> | ((route: string) => T | undefined)): T | undefined {
  if (!rule) return undefined;
  if (typeof rule === 'function') return rule(baseRoute) ?? rule(route);
  return rule[baseRoute] ?? rule[route];
}

/** 解析 lastmod */
function resolveLastmod(route: string, options: SitemapOptions, file?: string): string | undefined {
  const mode = options.lastmod ?? 'file';
  const today = new Date().toISOString().split('T')[0];

  if (typeof mode === 'function') return mode(route) || today;
  if (mode === 'none') return undefined;
  if (mode === 'today') return today;

  // file：优先取产物文件的真实修改时间，比统一写当天更有参考价值
  if (mode === 'file') {
    const mtime = file ? getMtimeDate(file) : undefined;
    return mtime || today;
  }

  // 其余字符串视为固定的 lastmod 日期
  return mode;
}

function getMtimeDate(file: string): string | undefined {
  try {
    return fs.statSync(file).mtime.toISOString().split('T')[0];
  } catch {
    return undefined;
  }
}

/**
 * 生成 sitemap（及可选的 robots.txt）。
 *
 * 既可作为预渲染的收尾步骤（`sitemap: true`），也可独立调用：
 * ```ts
 * generateSitemap({ siteUrl: 'https://example.com', outDir: 'dist', languages: ['zh', 'en'] })
 * ```
 */
export function generateSitemap(options: SitemapOptions): SitemapResult {
  const logger = resolveLogger(options.logger, '[prerender-kit:sitemap]');
  const siteUrl = (options.siteUrl || '').replace(/\/+$/, '');
  const result: SitemapResult = { file: '', files: [], urls: 0 };

  if (!siteUrl) {
    logger.error('缺少 siteUrl，已跳过 sitemap 生成');
    return result;
  }

  const outDir = options.outDir ? path.resolve(options.outDir) : '';
  const sourceRoutes = options.routes?.length ? options.routes : outDir ? collectRoutesFromDir(outDir) : [];
  const routes = sourceRoutes.map((route) => normalizeRoute(route)).filter((route) => route && !isExcluded(route, options.exclude));

  if (!routes.length) {
    logger.warn('未获取到任何路由，已跳过 sitemap 生成');
    return result;
  }

  const base = normalizeBase(options.base);
  const languages = options.languages?.length ? options.languages : [];
  const xDefault = options.xDefault !== false;
  const outputFileResolver = options.outputFile || defaultOutputFile;

  const entries: SitemapUrlEntry[] = routes.map((rawRoute) => {
    const route = normalizeRoute(rawRoute) || '/';
    const { baseRoute } = languages.length ? detectLanguage(route, languages) : { baseRoute: route };
    const file = outDir ? outputFileResolver(route, outDir) : undefined;

    const alternates = languages.length
      ? [
          ...languages.map((lang) => ({
            hreflang: lang,
            href: toUrl(siteUrl, base, toLanguageRoute(baseRoute, lang, options.languageRoute)),
          })),
          ...(xDefault ? [{ hreflang: 'x-default', href: toUrl(siteUrl, base, baseRoute) }] : []),
        ]
      : undefined;

    return {
      loc: toUrl(siteUrl, base, route),
      lastmod: resolveLastmod(route, options, file),
      changefreq: resolveRule(route, baseRoute, options.changeFreq) ?? options.defaultChangeFreq ?? 'weekly',
      priority: resolveRule(route, baseRoute, options.priority) ?? options.defaultPriority ?? 0.5,
      alternates,
    };
  });

  result.urls = entries.length;

  const outFile = options.outFile ? path.resolve(options.outFile) : path.join(outDir, 'sitemap.xml');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const maxUrls = options.maxUrlsPerFile === 0 ? 0 : options.maxUrlsPerFile || DEFAULT_MAX_URLS_PER_FILE;

  if (maxUrls > 0 && entries.length > maxUrls) {
    // 超限时拆分为多个 sitemap，并生成 sitemap index
    const dir = path.dirname(outFile);
    const name = path.basename(outFile, '.xml');
    const parts: string[] = [];

    for (let i = 0, fileIndex = 1; i < entries.length; i += maxUrls, fileIndex++) {
      const partName = `${name}-${fileIndex}.xml`;
      const partFile = path.join(dir, partName);
      writeSitemapFile(partFile, buildUrlSetXml(entries.slice(i, i + maxUrls)), options.gzip);
      parts.push(partFile);
    }

    const today = new Date().toISOString().split('T')[0];
    const partUrls = parts.map((file) => `${siteUrl}${base}/${path.basename(file)}`);
    fs.writeFileSync(outFile, buildSitemapIndexXml(partUrls.map((loc) => ({ loc, lastmod: today }))), 'utf8');

    result.file = outFile;
    result.files = parts;
    result.index = outFile;
    logger.info(`URL 数 ${entries.length} 超过单文件上限 ${maxUrls}，已拆分为 ${parts.length} 个 sitemap 并生成 index`);
  } else {
    writeSitemapFile(outFile, buildUrlSetXml(entries), options.gzip);
    result.file = outFile;
    result.files = [outFile];
  }

  if (options.robots) {
    const robotsFile = path.join(path.dirname(outFile), 'robots.txt');
    const sitemapUrls = [toUrl(siteUrl, base, `/${path.basename(result.file)}`)];
    const robotsOptions: RobotsOptions = options.robots === true ? {} : options.robots;
    fs.writeFileSync(
      robotsFile,
      buildRobotsTxt({ ...robotsOptions, sitemaps: robotsOptions.sitemaps?.length ? robotsOptions.sitemaps : sitemapUrls }),
      'utf8',
    );
    result.robots = robotsFile;
  }

  logger.info(`sitemap 已生成: ${result.file}（共 ${entries.length} 个 URL）`);

  return result;
}

/** 写入 sitemap 文件，可选同时输出 .gz */
function writeSitemapFile(file: string, xml: string, gzip?: boolean): void {
  fs.writeFileSync(file, xml, 'utf8');
  if (gzip) fs.writeFileSync(`${file}.gz`, zlib.gzipSync(Buffer.from(xml, 'utf8')));
}
