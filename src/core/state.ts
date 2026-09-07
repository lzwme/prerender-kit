import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrerenderState, PrerenderStateRoute, ResumeOptions } from '../types.js';
import { getMtimeMs, writeFileSafe } from '../utils/fs.js';

/** 默认状态文件名（隐藏文件，位于 outDir 下，便于 CI 直接缓存整个产物目录） */
export const DEFAULT_STATE_FILE = '.prerender-state.json';

/** 计算构建指纹时最多纳入的文件数量，避免超大项目下无意义的全量遍历 */
const MAX_SIGNATURE_FILES = 2000;

/** 解析 resume 配置。未开启时返回 null */
export function resolveResumeOptions(resume?: boolean | ResumeOptions): ResumeOptions | null {
  if (resume === true) return {};
  if (!resume) return null;
  return resume;
}

/** 解析状态文件的绝对路径。未开启 resume 时返回空字符串 */
export function resolveStateFile(outDir: string, resume?: boolean | ResumeOptions): string {
  if (!resolveResumeOptions(resume)) return '';
  const custom = typeof resume === 'object' ? resume.file : '';
  return path.resolve(outDir, custom || DEFAULT_STATE_FILE);
}

/** 读取状态文件。不存在或格式非法（版本不匹配、被写坏）时返回 null */
export function loadState(file: string): PrerenderState | null {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as PrerenderState;
    if (state?.version !== 1 || typeof state.routes !== 'object' || !state.routes) return null;
    return state;
  } catch {
    return null;
  }
}

/** 落盘状态文件（原子写入，避免中断时写坏状态导致进度全丢） */
export function saveState(file: string, state: PrerenderState): void {
  state.updatedAt = Date.now();
  writeFileSafe(file, JSON.stringify(state, null, 2));
}

/** 创建一份空状态 */
export function createState(signature: string, outDir: string): PrerenderState {
  const now = Date.now();
  return { version: 1, signature, outDir, startedAt: now, updatedAt: now, routes: {} };
}

/**
 * 判断路由是否可从断点状态中恢复（跳过渲染）。需同时满足：
 * 1. 状态中标记为 done；
 * 2. 产物文件仍存在（被删除则重新渲染）；
 * 3. 产物的 mtime 与 size 与记录一致。
 *
 * 第 3 点用于识别「产物被外部改写」：典型场景是 `/` 的产物就是 `<outDir>/index.html`，
 * 而它同时是构建产物的入口文件——每次重新构建都会覆写它，
 * 仅凭 mtime 新鲜度会误判为「已渲染」，导致首页永远拿不到预渲染内容。
 */
export function isRouteResumable(state: PrerenderState | null, route: string, file: string): boolean {
  const record = state?.routes[route];
  if (record?.status !== 'done') return false;

  try {
    const stat = fs.statSync(file);
    return Math.floor(stat.mtimeMs) === Math.floor(record.mtime) && stat.size === record.size;
  } catch {
    return false;
  }
}

/** 写入/更新一条路由记录 */
export function markStateRoute(
  state: PrerenderState,
  route: string,
  status: PrerenderStateRoute['status'],
  file: string,
  error?: unknown,
): void {
  const record: PrerenderStateRoute = {
    status,
    file,
    size: getFileSize(file),
    mtime: getMtimeMs(file),
    updatedAt: Date.now(),
  };

  if (error != null) {
    record.error = String(error instanceof Error ? error.message : error).slice(0, 500);
  }

  state.routes[route] = record;
}

/**
 * 计算构建指纹，用于判断「已有产物是否属于当前这次构建」。
 *
 * 这是断点续传正确性的关键：仅凭「产物存在」无法区分
 * 「本次构建已渲染」与「上次构建遗留的陈旧产物」。
 *
 * 优先使用显式的 buildId；否则取 `<outDir>/assets` 下的文件名列表
 * （vite / webpack 的产物文件名自带 content hash，可稳定反映内容变化）。
 *
 * 注意：**不能**把入口 index.html 的 mtime 纳入指纹——预渲染 `/` 时会覆写
 * `<outDir>/index.html`，导致指纹在同一次构建的两次运行之间发生变化，
 * 断点状态被自身失效。assets 由构建产出、预渲染不会改动，是稳定的指纹来源。
 *
 * 无法计算指纹（无 buildId 且无 assets 目录）时返回空字符串，
 * 此时退化为「仅按路由完成状态续跑」。
 */
export function resolveSignature(outDir: string, buildId?: string): string {
  if (buildId) return `id:${buildId}`;

  const parts: string[] = [];
  collectAssets(outDir, parts);
  if (!parts.length) return '';

  return crypto.createHash('sha256').update(parts.sort().join('|')).digest('hex').slice(0, 16);
}

/** 收集 assets 目录下的文件名（含 content hash）作为内容指纹来源 */
function collectAssets(outDir: string, parts: string[]): void {
  const assetsDir = path.join(outDir, 'assets');
  if (!fs.existsSync(assetsDir)) return;

  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (parts.length >= MAX_SIGNATURE_FILES) return;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) parts.push(`${prefix}${entry.name}`);
    }
  };

  walk(assetsDir, 'assets/');
}

/** 获取文件大小。文件不存在时返回 0 */
function getFileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
