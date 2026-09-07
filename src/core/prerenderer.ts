import fs from 'node:fs';
import path from 'node:path';
import { createOptimizeStats, mergeOptimizeStats } from '../optimize/files.js';
import { optimizeHtml } from '../optimize/html.js';
import { resolveOptimizeOptions } from '../optimize/options.js';
import { generateSitemap } from '../sitemap/generate.js';
import type {
  HtmlOptimizeOptions,
  HtmlOptimizeStats,
  Logger,
  PrerenderOptions,
  PrerenderResult,
  Renderer,
  ResolvedPrerenderOptions,
  SitemapOptions,
  StaticServer,
} from '../types.js';
import { runConcurrency } from '../utils/concurrency.js';
import { toPosixPath, writeFileSafe } from '../utils/fs.js';
import { resolveLogger } from '../utils/logger.js';
import { transformHtml } from './html.js';
import { extractLinks } from './links.js';
import { createPuppeteerRenderer } from './renderer.js';
import { buildPageUrl, defaultOutputFile, getMaxAgeMs, isRouteFresh, normalizeRoutes } from './routes.js';
import { createStaticServer } from './static-server.js';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_VIEWPORT = { width: 1024, height: 768 };

/** 填充默认值 */
export function resolveOptions(options: PrerenderOptions): ResolvedPrerenderOptions {
  if (!options?.routes?.length) throw new Error('[prerender-kit] 缺少必要的 routes 配置');
  if (!options?.outDir) throw new Error('[prerender-kit] 缺少必要的 outDir 配置');

  return {
    ...options,
    outDir: path.resolve(options.outDir),
    base: options.base || '/',
    concurrency: Math.max(1, Number(options.concurrency) || DEFAULT_CONCURRENCY),
    maxAge: Number.isFinite(Number(options.maxAge)) && Number(options.maxAge) >= 0 ? Number(options.maxAge) : 60,
    waitForSelector: options.waitForSelector || 'body',
    viewport: options.viewport || DEFAULT_VIEWPORT,
  };
}

/**
 * 与构建工具完全解耦的预渲染核心。
 *
 * ```ts
 * const result = await new Prerenderer({ routes, outDir, baseUrl }).render()
 * ```
 *
 * 渲染流程按「层」推进：同一层内的路由并发渲染，渲染完成后若开启 `discoverLinks`，
 * 会从产物中提取新的站内链接作为下一层，直至没有新路由或达到 `maxRoutes` 上限。
 */
export class Prerenderer {
  /** 填充默认值后的配置 */
  readonly options: ResolvedPrerenderOptions;

  private readonly logger: Logger;

  private readonly outputFile: NonNullable<PrerenderOptions['outputFile']>;

  /** HTML 瘦身配置，未启用时为 null */
  private readonly optimizeOptions: HtmlOptimizeOptions | null;

  /** HTML 瘦身统计累计 */
  private optimizeStats: HtmlOptimizeStats = createOptimizeStats();

  /** 已处理的路由计数，用于日志进度显示 */
  private progress = 0;

  /** 按需启动的渲染器与静态服务 */
  private renderer: Renderer | null = null;

  private server: StaticServer | null = null;

  constructor(options: PrerenderOptions) {
    this.options = resolveOptions(options);
    this.outputFile = options.outputFile || defaultOutputFile;
    this.optimizeOptions = resolveOptimizeOptions(options.optimize);
    this.logger = resolveLogger(options.logger);
  }

  /** 执行预渲染 */
  async render(): Promise<PrerenderResult> {
    const startedAt = Date.now();
    const { options, logger } = this;

    const result: PrerenderResult = {
      total: 0,
      pending: [],
      skipped: [],
      expired: [],
      invalid: [],
      rendered: [],
      failed: [],
      files: [],
      discovered: [],
      pageErrors: {},
      duration: 0,
    };

    const seen = new Set<string>();
    let frontier = this.seedRoutes(result, seen);

    try {
      while (frontier.length) {
        const toRender: string[] = [];
        const foundLinks: string[] = [];

        for (const route of frontier) {
          const file = this.outputFile(route, options.outDir);
          if (!file) {
            result.invalid.push(route);
            logger.warn(`路由 ${route} 无效(不支持含 query 参数)，已跳过`);
            continue;
          }

          if (isRouteFresh(file, options.force, options.maxAge)) {
            result.skipped.push(route);
            // 命中缓存时仍可从已有产物中继续发现链接，保证增量场景下不会漏掉路由
            if (options.discoverLinks) foundLinks.push(...this.discover(readHtml(file), route));
            continue;
          }

          if (fs.existsSync(file)) result.expired.push(route);
          toRender.push(route);
        }

        if (toRender.length) {
          result.pending.push(...toRender);
          await this.renderBatch(toRender, result, foundLinks);
        }

        frontier = this.nextFrontier(foundLinks, seen, result);
      }
    } finally {
      await this.closeAll();
    }

    result.total = seen.size;
    result.duration = Date.now() - startedAt;

    if (this.optimizeOptions && this.optimizeStats.files) {
      result.optimize = this.optimizeStats;
      logger.info(
        `HTML 瘦身：${this.optimizeStats.files} 个文件 ` +
          `${(this.optimizeStats.sizeBefore / 1024).toFixed(2)}KB -> ${(this.optimizeStats.sizeAfter / 1024).toFixed(2)}KB，移除 SVG ` +
          `${this.optimizeStats.svgRemoved} 个、内联样式 ${this.optimizeStats.inlineStylesRemoved} 个、class 属性 ${this.optimizeStats.classAttributesRemoved} 个`,
      );
    }

    if (options.sitemap) {
      const sitemapOptions: SitemapOptions = options.sitemap === true ? {} : options.sitemap;
      result.sitemap = generateSitemap({
        // 未显式指定路由时从产物目录扫描，保证 sitemap 与实际产物一致
        routes: sitemapOptions.routes?.length ? sitemapOptions.routes : [...result.rendered, ...result.skipped],
        outputFile: this.outputFile,
        siteUrl: sitemapOptions.siteUrl || options.baseUrl,
        ...sitemapOptions,
        outDir: sitemapOptions.outDir || options.outDir,
      });
    }

    if (options.force) {
      if (result.expired.length) logger.info(`已忽略已有产物，强制重新渲染 ${result.expired.length} 个路由`);
    } else if (result.skipped.length || result.expired.length) {
      logger.info(
        `增量预渲染：${result.skipped.length} 个产物在 ${Math.round(getMaxAgeMs(options.maxAge) / 60000)} 分钟内已跳过，` +
          `${result.expired.length} 个已过期重新渲染。设置 force: true 可强制全量重新渲染`,
      );
    }

    if (result.rendered.length || result.failed.length) {
      logger.info(`预渲染完成：成功 ${result.rendered.length} 个，失败 ${result.failed.length} 个，耗时 ${result.duration}ms`);
    } else if (!result.skipped.length && !result.invalid.length) {
      logger.info('没有需要预渲染的路由，跳过');
    }

    return result;
  }

  /** 归一化初始路由，返回第一层待处理队列 */
  private seedRoutes(result: PrerenderResult, seen: Set<string>): string[] {
    const routes = normalizeRoutes(this.options.routes);
    const valid: string[] = [];

    for (const route of routes) {
      seen.add(route);
      if (route.includes('?')) {
        result.invalid.push(route);
        this.logger.warn(`路由 ${route} 无效(不支持含 query 参数)，已跳过`);
        continue;
      }
      valid.push(route);
    }

    if (this.options.discoverLinks) this.logger.info(`已开启链接自动发现，入口路由 ${valid.length} 个`);

    return valid;
  }

  /** 计算下一层待处理路由：去重、过滤已处理、并遵守 maxRoutes 上限 */
  private nextFrontier(links: string[], seen: Set<string>, result: PrerenderResult): string[] {
    const { options, logger } = this;
    const maxRoutes = Number(options.maxRoutes) || 0;
    const next: string[] = [];

    for (const link of links) {
      if (seen.has(link)) continue;
      if (maxRoutes && seen.size >= maxRoutes) {
        logger.warn(`已达到 maxRoutes 上限(${maxRoutes})，停止发现新路由`);
        break;
      }
      seen.add(link);
      next.push(link);
      result.discovered.push(link);
    }

    return next;
  }

  /** 并发渲染一批路由 */
  private async renderBatch(routes: string[], result: PrerenderResult, foundLinks: string[]): Promise<void> {
    const { options, logger } = this;
    const baseUrl = await this.ensureStarted();
    const total = this.progress + routes.length;

    logger.info(`开始预渲染：本批 ${routes.length} 个路由，并发数 ${options.concurrency}，渲染器 ${this.renderer?.name || 'unknown'}`);

    const tasks = routes.map((route) => async () => this.renderRoute(route, total, baseUrl));
    const settled = await runConcurrency(tasks, options.concurrency);

    settled.forEach((item, index) => {
      const route = routes[index];
      const errors = this.collectErrors(route, baseUrl, result);

      if (item.status === 'rejected') {
        result.failed.push(route);
        logger.error(`路由 ${route} 预渲染失败：`, item.reason);
        return;
      }

      if (options.failOnPageError && errors.length) {
        result.failed.push(route);
        logger.error(`路由 ${route} 存在页面运行时错误：\n  ${errors.join('\n  ')}`);
        return;
      }

      result.rendered.push(route);
      result.files.push(item.value as string);
      if (options.discoverLinks) foundLinks.push(...this.discover(readHtml(item.value as string), route));
    });
  }

  /** 渲染单个路由，返回产物文件路径 */
  private async renderRoute(route: string, total: number, baseUrl: string): Promise<string> {
    const { options, logger } = this;
    const file = this.outputFile(route, options.outDir);
    if (!file) throw new Error(`路由 ${route} 无法解析出产物路径`);

    const url = buildPageUrl(baseUrl, options.base, route, options.hashHistory);
    const html = await this.renderer!.render(url, {
      delay: options.delay,
      waitUntil: options.waitUntil,
      waitForSelector: options.waitForSelector,
      viewport: options.viewport,
    });

    let content = await transformHtml(html, {
      route,
      replaceUrls: this.getReplaceUrls(baseUrl),
      removeStyle: options.removeStyle !== false,
      callback: options.callback,
    });

    // HTML 瘦身（可选）：落盘前按配置裁剪内联 SVG、大段样式、class 属性并压缩
    if (this.optimizeOptions) {
      const { html: optimized, stats } = optimizeHtml(content, this.optimizeOptions);
      content = optimized;
      this.optimizeStats = mergeOptimizeStats(this.optimizeStats, stats);
    }

    writeFileSafe(file, content);
    logger.info(`[${++this.progress}/${total}] ${url} => ${toPosixPath(file)}`);

    return file;
  }

  /** 从渲染结果中收集页面运行时错误 */
  private collectErrors(route: string, baseUrl: string, result: PrerenderResult): string[] {
    const url = buildPageUrl(baseUrl, this.options.base, route, this.options.hashHistory);
    const errors = this.renderer?.drainErrors?.(url) || [];
    if (errors.length) {
      result.pageErrors[route] = errors;
      if (!this.options.failOnPageError) this.logger.warn(`路由 ${route} 存在 ${errors.length} 个页面运行时错误`);
    }
    return errors;
  }

  /** 提取页面中的站内链接 */
  private discover(html: string, route: string): string[] {
    if (!html) return [];
    const links = extractLinks(html, {
      baseUrl: this.options.baseUrl || this.server?.url,
      filter: this.options.discoverFilter,
    });
    if (links.length) this.logger.debug?.(`路由 ${route} 发现 ${links.length} 个链接`);
    return links;
  }

  /** 需要从产物中清理掉的地址：默认清理用于渲染的站点地址，附加用户自定义的 replaceUrl */
  private getReplaceUrls(baseUrl: string): string[] {
    const { options } = this;
    const list = options.removeBaseUrl === false ? [] : [baseUrl];
    if (options.replaceUrl) list.push(...(Array.isArray(options.replaceUrl) ? options.replaceUrl : [options.replaceUrl]));
    return list;
  }

  /** 惰性启动渲染器与静态服务：全部命中缓存时不会启动浏览器 */
  private async ensureStarted(): Promise<string> {
    if (this.renderer) return this.getBaseUrl();

    this.server = await this.prepareServer();
    this.renderer = await this.createRenderer();
    await this.renderer.launch();

    return this.getBaseUrl();
  }

  private getBaseUrl(): string {
    const baseUrl = this.options.baseUrl || this.server?.url;
    if (!baseUrl) throw new Error('缺少站点访问地址：请配置 baseUrl，或允许自动启动内置静态服务');
    return baseUrl;
  }

  /** 释放渲染器与静态服务 */
  private async closeAll(): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];
    if (this.renderer) tasks.push(this.renderer.close());
    if (this.server) tasks.push(this.server.close());
    this.renderer = null;
    this.server = null;
    await Promise.allSettled(tasks);
  }

  /**
   * 确定站点访问地址：
   * 1. 已配置 baseUrl 时直接使用（独立使用 / CI 场景）；
   * 2. 否则启动内置静态服务，并在渲染结束后关闭。
   */
  private async prepareServer(): Promise<StaticServer | null> {
    if (this.options.baseUrl) return null;
    return createStaticServer({
      root: this.options.staticDir || this.options.outDir,
      port: this.options.staticPort,
      base: this.options.base,
      logger: this.logger,
    });
  }

  /** 创建渲染器。支持传入 Renderer 实例或工厂函数，默认使用 puppeteer */
  private async createRenderer(): Promise<Renderer> {
    const { renderer } = this.options;
    if (!renderer) return createPuppeteerRenderer(this.options);
    return typeof renderer === 'function' ? await renderer() : renderer;
  }
}

/** 读取文件内容用于链接发现。文件不存在时返回空字符串 */
function readHtml(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 快捷方法：执行一次预渲染 */
export async function prerender(options: PrerenderOptions): Promise<PrerenderResult> {
  return new Prerenderer(options).render();
}
