import fs from 'node:fs';
import path from 'node:path';
import { Prerenderer } from '../core/prerenderer.js';
import { createStaticServer } from '../core/static-server.js';
import type { PrerenderOptions, VitePrerenderOptions, VitePrerenderPlugin, ViteResolvedConfigLike } from '../types.js';
import { resolveLogger } from '../utils/logger.js';

/** 预览服务的最小抽象：vite preview 与内置静态服务都满足该结构 */
interface PreviewServer {
  url: string;
  close: () => Promise<void>;
}

/** vite 预览服务中间件的最小结构 */
interface PreviewMiddlewareServerLike {
  middlewares: {
    use(handler: (req: PreviewRequestLike, res: unknown, next: () => void) => void): void;
  };
}

interface PreviewRequestLike {
  url?: string;
  headers: Record<string, string | undefined>;
}

/**
 * 启动 vite 预览服务，用于为预渲染提供访问地址。
 * 优先使用 vite 自身的 preview API（比 spawn `vite preview` 子进程更可靠、无需解析 stdout）；
 * 若不可用则回退到内置的静态服务。
 */
interface PreviewServerConfig {
  root: string;
  base: string;
  outDir: string;
  /** 服务类型，builtin 时不使用 vite preview */
  server?: 'auto' | 'vite' | 'builtin';
  apiFallback?: PrerenderOptions['apiFallback'];
  apiFallbackPrefix?: string;
}

async function startPreviewServer(cfg: PreviewServerConfig, logger = resolveLogger(undefined)): Promise<PreviewServer> {
  const builtin = (): Promise<PreviewServer> =>
    createStaticServer({
      root: cfg.outDir,
      base: cfg.base,
      apiFallback: cfg.apiFallback,
      apiFallbackPrefix: cfg.apiFallbackPrefix,
      logger,
    });

  if (cfg.server === 'builtin') return builtin();

  try {
    // ESM 产物下可直接使用原生 import()，无需间接构造
    const vite = await import('vite');

    if (typeof vite.preview === 'function') {
      const server = await vite.preview({
        root: cfg.root,
        base: cfg.base,
        logLevel: 'warn',
        preview: { port: 0, strictPort: false, open: false },
      });
      const url = server.resolvedUrls?.local?.[0]?.replace(/\/+$/, '');
      if (url) {
        logger.debug?.(`已启动 vite 预览服务: ${url}`);
        return {
          url,
          close: async () => {
            await server.close?.();
          },
        };
      }
      await server.close?.();
    }
  } catch (error) {
    logger.debug?.(`启动 vite 预览服务失败，回退内置静态服务: ${String(error)}`);
  }

  return builtin();
}

/**
 * 创建 vite 预渲染插件。
 *
 * ```ts
 * // vite.config.ts
 * import { createVitePlugin } from '@lzwme/prerender-kit'
 *
 * export default defineConfig({
 *   plugins: [react(), createVitePlugin({ routes: ['/', '/about'] })],
 * })
 * ```
 *
 * outDir / base 默认从 vite 配置中自动获取，无需重复配置。
 */
export function createVitePlugin(options: VitePrerenderOptions): VitePrerenderPlugin {
  const logger = resolveLogger(options.logger);
  const cfg = { root: '', base: '/', outDir: '', mode: '' };

  return {
    name: 'prerender-kit',
    enforce: 'post',
    apply: 'build',
    // Vite 6+ 的 Environment API：仅在 client 环境生效，避免 SSR 构建时被重复触发
    applyToEnvironment(environment: { name?: string }) {
      return environment?.name == null || environment.name === 'client';
    },
    configResolved(config: ViteResolvedConfigLike) {
      cfg.root = config.root || process.cwd();
      cfg.base = config.base || '/';
      cfg.mode = config.mode || '';
      cfg.outDir = config.build?.outDir ? path.resolve(cfg.root, config.build.outDir) : '';
    },
    // 让 `vite preview` 也能正确访问 /about 这类无扩展名的预渲染产物
    configurePreviewServer(server: PreviewMiddlewareServerLike) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        // 含有扩展名的请求交给 vite 处理（静态资源、html 等）
        if (path.extname(url.pathname)) return next();

        const file = path.join(cfg.outDir, url.pathname.split(path.posix.sep).join(path.sep), 'index.html');
        req.url = fs.existsSync(file) ? `${url.pathname}/index.html${url.search}` : (options.previewFallback ?? '/index.html');
        return next();
      });
    },
    async closeBundle() {
      const outDir = options.outDir ? path.resolve(cfg.root || process.cwd(), options.outDir) : cfg.outDir;
      if (!outDir) throw new Error('[prerender-kit] 未能获取 outDir，请在插件配置中显式指定');

      let server: PreviewServer | null = null;
      try {
        server = options.baseUrl
          ? null
          : await startPreviewServer(
              {
                root: cfg.root,
                base: cfg.base,
                outDir,
                server: options.server,
                apiFallback: options.apiFallback,
                apiFallbackPrefix: options.apiFallbackPrefix,
              },
              logger,
            );
        await new Prerenderer({
          ...options,
          outDir,
          base: options.base ?? cfg.base,
          baseUrl: options.baseUrl ?? server?.url,
        }).render();
      } finally {
        await server?.close();
      }
    },
  };
}

/** createVitePlugin 的别名，语义更直观 */
export const prerenderVite = createVitePlugin;
