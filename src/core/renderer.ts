import type { Renderer, RenderOptions } from '../types.js';
import { dynamicImport } from '../utils/import.js';

/** puppeteer Page 的最小结构 */
export interface PageLike {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  setViewport(viewport: { width: number; height: number }): Promise<unknown>;
  waitForSelector(selector: string): Promise<unknown>;
  content(): Promise<string>;
  close(): Promise<void>;
  /** 页面事件监听（可选，未提供时不会收集运行时错误） */
  on?: (event: 'pageerror' | 'console' | 'requestfailed', handler: (...args: any[]) => void) => void;
}

/** puppeteer Browser 的最小结构 */
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** puppeteer 模块的最小结构 */
export interface PuppeteerLike {
  launch(options?: Record<string, unknown>): Promise<BrowserLike>;
}

export interface PuppeteerRendererOptions extends RenderOptions {
  /** puppeteer.launch 的额外参数，如 executablePath、args、headless 等 */
  launchOptions?: Record<string, unknown>;
  /**
   * 自定义 puppeteer 实现：
   * - 传入模块名(如 puppeteer-core)则动态加载该模块
   * - 传入对象则直接使用（便于注入 mock 或自定义封装）
   * 默认依次尝试加载 puppeteer、puppeteer-core
   */
  puppeteerModule?: string | PuppeteerLike;
}

/** 浏览器可执行文件路径的候选环境变量（按优先级排列） */
export const EXECUTABLE_PATH_ENV_KEYS = ['PUPPETEER_EXECUTABLE_PATH', 'CHROME_EXECUTABLE_PATH', 'CHROME_EXECUTABLE'] as const;

/**
 * 从环境变量中解析浏览器可执行文件路径。
 *
 * puppeteer 原生只识别 `PUPPETEER_EXECUTABLE_PATH`，这里额外支持
 * `CHROME_EXECUTABLE_PATH` / `CHROME_EXECUTABLE`，便于 CI、容器或
 * 自定义 Chrome 安装的场景统一配置。未设置时返回空字符串。
 */
export function resolveExecutablePath(env: NodeJS.ProcessEnv = process.env): string {
  for (const key of EXECUTABLE_PATH_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** 模块导出形态（ESM namespace 或 CJS module.exports） */
type PuppeteerModuleLike = PuppeteerLike & { default?: PuppeteerLike };

/** 尝试加载 puppeteer 模块。puppeteer 为可选依赖，未安装时给出明确指引 */
export async function resolvePuppeteer(puppeteerModule?: string | PuppeteerLike): Promise<PuppeteerLike> {
  if (puppeteerModule) {
    if (typeof puppeteerModule !== 'string') return puppeteerModule;
    const imported = (await dynamicImport(puppeteerModule)) as PuppeteerModuleLike;
    return imported?.default || imported;
  }

  for (const name of ['puppeteer', 'puppeteer-core']) {
    try {
      const imported = (await dynamicImport(name)) as PuppeteerModuleLike;
      const mod = imported?.default || imported;
      if (mod && typeof mod.launch === 'function') return mod;
    } catch {
      // 继续尝试下一个
    }
  }

  throw new Error('[prerender-kit] 未找到 puppeteer，请安装: npm i -D puppeteer（或通过 renderer / puppeteerModule 自定义渲染器）');
}

/**
 * 基于 puppeteer 的默认渲染器实现。
 * puppeteer 为可选 peer 依赖，仅在真正渲染时动态加载。
 */
export function createPuppeteerRenderer(options: PuppeteerRendererOptions = {}): Renderer {
  let browser: BrowserLike | null = null;
  const errorsByUrl = new Map<string, string[]>();

  /** 收集页面的运行时错误，便于在预渲染结果中上报（借鉴 SSR 方案里「渲染报错即暴露」的思路） */
  const watchPage = (page: PageLike, pageErrors: string[]) => {
    if (typeof page.on !== 'function') return;
    page.on('pageerror', (error: Error | string) => pageErrors.push(`[pageerror] ${error instanceof Error ? error.message : error}`));
    page.on('console', (message: { type?: () => string; text?: () => string }) => {
      if (message?.type?.() === 'error') pageErrors.push(`[console] ${message.text?.() ?? ''}`);
    });
  };

  return {
    name: 'puppeteer',
    drainErrors(url?: string) {
      if (url) {
        const current = errorsByUrl.get(url) || [];
        errorsByUrl.delete(url);
        return current;
      }
      const current = [...errorsByUrl.values()].flat();
      errorsByUrl.clear();
      return current;
    },
    async launch() {
      if (browser) return;
      const puppeteer = await resolvePuppeteer(options.puppeteerModule);
      const launchOptions: Record<string, unknown> = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: String(options.launchOptions?.executablePath ?? '').trim() || resolveExecutablePath() || undefined,
        ...options.launchOptions,
      };
      browser = await puppeteer.launch(launchOptions);
    },
    async render(url: string, renderOptions: RenderOptions = {}) {
      if (!browser) throw new Error('[prerender-kit] 渲染器尚未启动，请先调用 launch()');
      const merged = { ...options, ...renderOptions };
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      errorsByUrl.set(url, pageErrors);
      watchPage(page, pageErrors);

      try {
        const waitUntil = merged.waitUntil || 'domcontentloaded';
        await page.goto(url, { waitUntil });
        await page.setViewport(merged.viewport || { width: 1024, height: 768 });
        await page.waitForSelector(merged.waitForSelector || 'body');
        if (merged.delay) await new Promise((resolve) => setTimeout(resolve, merged.delay));
        return await page.content();
      } finally {
        await page.close();
      }
    },
    async close() {
      if (!browser) return;
      const current = browser;
      browser = null;
      await current.close();
    },
  };
}
