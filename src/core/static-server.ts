import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Logger, StaticServer } from '../types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export interface CreateStaticServerOptions {
  /** 静态服务根目录 */
  root: string;
  /** 监听端口，默认 0(随机可用端口) */
  port?: number;
  /** 站点 base 路径。请求路径会先剥掉该前缀再映射文件，如 /sub/ */
  base?: string;
  /** 未命中文件时是否回退到 index.html（SPA 必需）。默认 true */
  spaFallback?: boolean;
  /** 日志实例 */
  logger?: Logger;
}

/** 归一化 base 路径：始终以 / 开头、不以 / 结尾，根路径返回空字符串 */
export function normalizeBase(base?: string): string {
  return `/${(base || '').replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '');
}

/**
 * 零依赖的轻量静态文件服务，用于在没有外部 baseUrl 时提供预渲染所需的访问地址。
 * 相比依赖 express/serve-static，这里保持核心包零运行时依赖。
 */
export function createStaticServer(options: CreateStaticServerOptions): Promise<StaticServer> {
  const { root, spaFallback = true, logger } = options;
  const rootDir = path.resolve(root);
  const basePath = normalizeBase(options.base);

  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
      // 剥掉部署 base 前缀后再映射为本地文件
      if (basePath && (urlPath === basePath || urlPath.startsWith(`${basePath}/`))) urlPath = urlPath.slice(basePath.length) || '/';
      let filePath = path.resolve(rootDir, `.${urlPath}`);

      // 防目录穿越
      if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
      if (!fs.existsSync(filePath) && spaFallback) filePath = path.join(rootDir, 'index.html');

      if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      logger?.debug?.(`静态服务响应异常: ${String(error)}`);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = `http://127.0.0.1:${port}`;
      logger?.debug?.(`内置静态服务已启动: ${url} => ${rootDir}`);
      resolve({
        url,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
