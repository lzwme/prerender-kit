import path from 'node:path';
import type { OutputFileResolver, ResolveRoutesResult } from '../types.js';
import { getMtimeMs } from '../utils/fs.js';

/** 产物默认有效期(分钟) */
export const DEFAULT_MAX_AGE_MINUTES = 60;

/**
 * 路由归一化：补齐前导 / 、去除尾部斜杠与 hash。
 * 注意：含 query 参数(?)的路由不做处理，仍会被判定为非法路由
 */
export function normalizeRoute(route: string): string {
  if (!route) return '';
  let result = route.trim();
  const hashIndex = result.indexOf('#');
  if (hashIndex >= 0) result = result.slice(0, hashIndex);
  if (!result.startsWith('/')) result = `/${result}`;
  if (result.length > 1 && !result.endsWith('.html')) result = result.replace(/\/+$/, '');
  return result;
}

/** 路由列表归一化并去重，保持原有顺序 */
export function normalizeRoutes(routes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const route of routes || []) {
    const normalized = normalizeRoute(route);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * 默认的产物路径规则：
 * - `/about` -> `<outDir>/about/index.html`
 * - `/404.html` -> `<outDir>/404.html`
 *
 * 返回空字符串表示路由非法（不支持含 query 参数的路由静态化）
 */
export const defaultOutputFile: OutputFileResolver = (route, outDir) => {
  if (!route || route.includes('?')) return '';
  const clean = route.replace(/^\/+/, '');
  return clean.endsWith('.html') ? path.join(outDir, clean) : path.join(outDir, clean, 'index.html');
};

/**
 * 计算产物有效期(毫秒)。
 * 非法值(非数字、负数、NaN)统一回退为 DEFAULT_MAX_AGE_MINUTES
 */
export function getMaxAgeMs(maxAge?: number): number {
  const minutes = Number(maxAge);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_MAX_AGE_MINUTES) * 60 * 1000;
}

/**
 * 判断产物是否在有效期内（可跳过渲染）。
 * force 为 true 时始终返回 false
 */
export function isRouteFresh(file: string, force?: boolean, maxAge?: number): boolean {
  if (force === true || !file) return false;
  const mtime = getMtimeMs(file);
  if (mtime < 0) return false;
  return Date.now() - mtime < getMaxAgeMs(maxAge);
}

/**
 * 对路由进行分类，实现增量预渲染：
 * - invalid：非法路由，无法生成静态产物
 * - skipped：产物存在且在有效期内，跳过
 * - expired：产物存在但已过期，重新渲染
 * - pending：需要渲染的路由（无产物 + expired）
 */
export function resolveRoutes(
  routes: string[],
  outDir: string,
  options: { force?: boolean; maxAge?: number; outputFile?: OutputFileResolver } = {},
): ResolveRoutesResult {
  const { force, maxAge } = options;
  const outputFile = options.outputFile || defaultOutputFile;
  const result: ResolveRoutesResult = { pending: [], skipped: [], expired: [], invalid: [] };

  for (const route of routes || []) {
    const file = outputFile(route, outDir);
    if (!file) {
      result.invalid.push(route);
      continue;
    }
    if (isRouteFresh(file, force, maxAge)) {
      result.skipped.push(route);
      continue;
    }
    if (getMtimeMs(file) >= 0) result.expired.push(route);
    result.pending.push(route);
  }

  return result;
}

/**
 * 拼接页面的完整访问地址。
 * @param baseUrl 站点地址，如 http://127.0.0.1:4173
 * @param base 站点 base 路径，如 / 或 /sub-path/
 * @param route 路由，如 /zh/about
 * @param hashHistory 是否为 hash 路由
 */
export function buildPageUrl(baseUrl: string, base: string, route: string, hashHistory?: boolean): string {
  const origin = baseUrl.replace(/\/+$/, '');
  const basePath = `/${(base || '').replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '');
  return hashHistory ? `${origin}${basePath}/#${route}` : `${origin}${basePath}${route}`;
}
