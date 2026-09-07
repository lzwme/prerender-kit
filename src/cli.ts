import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { Prerenderer } from './core/prerenderer.js';
import type { PrerenderOptions, PrerenderResult, SitemapOptions } from './types.js';

/** 解析 CLI 数值参数。0 为合法值，不能用 truthy 判断 */
export function parseCliNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** 从配置文件加载配置。支持 .json 与 .js/.mjs/.cjs（导出对象或 default） */
export async function loadConfigFile(file: string): Promise<Partial<PrerenderOptions>> {
  const absPath = path.resolve(file);
  if (!fs.existsSync(absPath)) throw new Error(`配置文件不存在: ${absPath}`);

  if (absPath.endsWith('.json')) return JSON.parse(fs.readFileSync(absPath, 'utf8')) as Partial<PrerenderOptions>;

  const mod = (await import(pathToFileURL(absPath).href)) as { default?: Partial<PrerenderOptions> } & Partial<PrerenderOptions>;
  return (mod.default || mod) as Partial<PrerenderOptions>;
}

/** 加载路由列表文件。支持 .json 数组、.txt(每行一个，# 开头为注释)、.js/.mjs 导出数组 */
export async function loadRoutesFile(file: string): Promise<string[]> {
  const absPath = path.resolve(file);
  if (!fs.existsSync(absPath)) throw new Error(`路由文件不存在: ${absPath}`);

  if (absPath.endsWith('.json')) {
    const list = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    return Array.isArray(list) ? list.map(String) : [];
  }

  if (/\.(txt|md)$/.test(absPath)) {
    return fs
      .readFileSync(absPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }

  const mod = (await import(pathToFileURL(absPath).href)) as { default?: unknown };
  const list = (mod.default || mod) as unknown;
  return Array.isArray(list) ? list.map(String) : [];
}

/** 合并 CLI 参数与配置文件中的 sitemap 配置 */
function resolveSitemapOptions(opts: Record<string, unknown>, configSitemap?: boolean | SitemapOptions): SitemapOptions {
  const base: SitemapOptions = configSitemap && typeof configSitemap === 'object' ? configSitemap : {};
  const languages = opts.languages
    ? String(opts.languages)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : base.languages;

  return {
    ...base,
    siteUrl: (opts.siteUrl as string) || base.siteUrl,
    languages,
    robots: opts.robots ? true : base.robots,
  };
}

/** 构建命令行程序 */
export function createProgram(): Command {
  return new Command()
    .name('prerender-kit')
    .alias('prkit')
    .description('通用的 SPA 预渲染(SSG)工具：将路由渲染为静态 HTML，支持独立使用与构建工具插件')
    .argument('[routes...]', '需要预渲染的路由，如 / /about')
    .option('-c, --config <file>', '配置文件(.js/.mjs/.cjs/.json)，可导出完整配置')
    .option('-r, --routes-file <file>', '路由列表文件(.json 数组 / .txt 每行一个 / .js 导出数组)')
    .option('-o, --out-dir <dir>', '预渲染产物输出目录')
    .option('-u, --base-url <url>', '已运行站点的访问地址，如 http://localhost:4173、https://example.com')
    .option('-s, --static-dir <dir>', '未提供 baseUrl 时，内置静态服务的根目录，默认取 out-dir')
    .option('-b, --base <path>', '站点 base 路径，默认 /')
    .option('-n, --concurrency <num>', '并发渲染数量，默认 5')
    .option('-d, --delay <ms>', '页面加载完成后的额外等待时间(ms)')
    .option('--max-age <minutes>', '产物有效期(分钟)，默认 60。超过该时长将重新渲染')
    .option('--wait-until <strategy>', '页面等待策略: load | domcontentloaded | networkidle0 | networkidle2')
    .option('--wait-for <selector>', '渲染前等待出现的选择器，默认 body')
    .option('--force', '强制重新渲染，忽略已存在的产物')
    .option('--resume', '启用断点续传：中断后再次运行可从上次进度继续')
    .option('--build-id <id>', '构建指纹。变化时断点状态失效并全量重新渲染')
    .option('--discover-links', '从产物中自动发现站内链接并加入预渲染队列')
    .option('--max-routes <num>', '预渲染路由总数上限，含自动发现的路由')
    .option('--fail-on-page-error', '页面存在运行时错误时视为渲染失败')
    .option('--optimize', '对产物执行 HTML 瘦身（移除内联 SVG、大段内联样式、class 并压缩）')
    .option('--sitemap', '生成 sitemap.xml（需配合 --site-url）')
    .option('--site-url <url>', '站点地址，如 https://example.com，用于生成 sitemap')
    .option('--languages <list>', '多语言列表(逗号分隔)，如 zh,en,zh-TW，用于生成 hreflang 链接')
    .option('--robots', '同时生成 robots.txt')
    .option('--hash', 'hash 路由模式')
    .option('--keep-style', '保留页面中的内联 <style> 标签')
    .option('--silent', '静默输出')
    .version(pkg.version, '-V, --version', '输出当前版本号')
    .helpOption('-h, --help', '显示帮助信息');
}

/** 执行命令行逻辑。返回进程退出码 */
export async function run(argv: string[] = process.argv): Promise<number> {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts();
  const cliRoutes = program.args;

  let config: Partial<PrerenderOptions> = {};
  if (opts.config) config = await loadConfigFile(opts.config);

  let fileRoutes: string[] = [];
  if (opts.routesFile) fileRoutes = await loadRoutesFile(opts.routesFile);

  const routes = [...(config.routes || []), ...fileRoutes, ...cliRoutes];

  const options: PrerenderOptions = {
    ...config,
    routes,
    outDir: opts.outDir || config.outDir || '',
    baseUrl: opts.baseUrl || config.baseUrl,
    base: opts.base || config.base,
    hashHistory: opts.hash || config.hashHistory,
    staticDir: opts.staticDir || config.staticDir,
    force: opts.force || config.force,
    discoverLinks: opts.discoverLinks || config.discoverLinks,
    failOnPageError: opts.failOnPageError || config.failOnPageError,
    optimize: opts.optimize ? true : config.optimize,
    sitemap: opts.sitemap || opts.siteUrl ? resolveSitemapOptions(opts, config.sitemap) : config.sitemap,
    maxRoutes: parseCliNumber(opts.maxRoutes) ?? config.maxRoutes,
    removeStyle: opts.keepStyle ? false : config.removeStyle,
    waitForSelector: opts.waitFor || config.waitForSelector,
    waitUntil: (opts.waitUntil as PrerenderOptions['waitUntil']) || config.waitUntil,
    logger: opts.silent ? false : config.logger,
    concurrency: parseCliNumber(opts.concurrency) ?? config.concurrency,
    delay: parseCliNumber(opts.delay) ?? config.delay,
    maxAge: parseCliNumber(opts.maxAge) ?? config.maxAge,
    buildId: (opts.buildId as string) || config.buildId,
    // CLI 只负责开关；自定义状态文件路径等细节配置以配置文件为准，避免双入口合并冲突
    resume: opts.resume ? (typeof config.resume === 'object' ? config.resume : true) : config.resume,
  };

  if (!options.routes.length || !options.outDir) {
    program.help({ error: true });
    return 1;
  }

  const result = await new Prerenderer(options).render();
  printSummary(result, opts.silent === true);

  return result.failed.length ? 1 : 0;
}

/** 输出执行结果摘要 */
function printSummary(result: PrerenderResult, silent?: boolean): void {
  if (silent) return;
  if (result.rendered.length) console.log(`\n成功渲染: ${result.rendered.length} 个`);
  if (result.resumed.length) console.log(`断点续传恢复: ${result.resumed.length} 个`);
  const skippedByFreshness = result.skipped.length - result.resumed.length;
  if (skippedByFreshness) console.log(`已跳过(产物在有效期内): ${skippedByFreshness} 个`);
  if (result.expired.length) console.log(`重新渲染(过期或强制): ${result.expired.length} 个`);
  if (result.discovered.length) console.log(`自动发现的路由: ${result.discovered.length} 个 -> ${result.discovered.join(', ')}`);
  if (result.invalid.length) console.log(`无效路由: ${result.invalid.length} 个`);
  if (result.failed.length) console.log(`渲染失败: ${result.failed.length} 个 -> ${result.failed.join(', ')}`);

  if (result.optimize?.files) {
    const { files, sizeBefore, sizeAfter } = result.optimize;
    console.log(`HTML 瘦身: ${files} 个文件，${(sizeBefore / 1024).toFixed(2)}KB -> ${(sizeAfter / 1024).toFixed(2)}KB`);
  }

  if (result.sitemap?.urls) console.log(`sitemap: ${result.sitemap.file}（${result.sitemap.urls} 个 URL）`);
  if (result.sitemap?.robots) console.log(`robots.txt: ${result.sitemap.robots}`);

  const errorRoutes = Object.keys(result.pageErrors);
  if (errorRoutes.length) {
    console.log(`存在页面运行时错误的路由: ${errorRoutes.length} 个`);
    for (const route of errorRoutes) console.log(`  ${route}\n    ${result.pageErrors[route].join('\n    ')}`);
  }
}
