import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeInlineStyle, replaceAll, transformHtml } from '../src/core/html.js';
import { createStaticServer, resolveApiFallback } from '../src/core/static-server.js';
import type { StaticServer } from '../src/types.js';
import { runConcurrency } from '../src/utils/concurrency.js';
import { createLogger } from '../src/utils/logger.js';

describe('html', () => {
  it('removeInlineStyle 应移除内联 style 标签', () => {
    const html = '<html><head><style>.a{color:red}</style></head><body><style>b{}</style></body></html>';
    expect(removeInlineStyle(html)).toBe('<html><head></head><body></body></html>');
  });

  it('replaceAll 无需转义即可替换全部', () => {
    expect(replaceAll('a.b.c', '.', '-')).toBe('a-b-c');
    expect(replaceAll('abc', '', '-')).toBe('abc');
  });

  it('transformHtml 应依次执行去样式、本地地址替换与 callback', async () => {
    const html = '<style>x{}</style><a href="http://127.0.0.1:4173/about">about</a>';
    const result = await transformHtml(html, {
      route: '/about',
      removeStyle: true,
      replaceUrls: ['http://127.0.0.1:4173'],
      callback: (content, route) => `${content}<!--${route}-->`,
    });
    expect(result).toBe('<a href="/about">about</a><!--/about-->');
  });
});

describe('logger', () => {
  it('logger 为 false 时应静默', () => {
    const logs: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    createLogger('[test]', false).info('hello');
    createLogger('[test]').info('world');
    console.log = original;

    expect(logs.length).toBe(1);
    expect(logs[0]).toEqual(['[test]', 'world']);
  });
});

describe('runConcurrency', () => {
  it('应保持输入顺序返回全部结果', async () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => async () => new Promise<number>((resolve) => setTimeout(() => resolve(n * 2), (6 - n) * 5)));
    const results = await runConcurrency(tasks, 2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([2, 4, 6, 8, 10]);
  });

  it('单个任务失败不影响其它任务', async () => {
    const tasks = [
      async () => 'ok',
      async () => {
        throw new Error('failed');
      },
      async () => 'ok2',
    ];
    const results = await runConcurrency(tasks, 1);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'ok2' });
  });

  it('空任务列表应返回空数组', async () => {
    expect(await runConcurrency([], 5)).toEqual([]);
  });
});

describe('apiFallback', () => {
  it('未配置或路径不匹配时不兜底', () => {
    expect(resolveApiFallback('/api/system/info', undefined)).toBeUndefined();
    expect(resolveApiFallback('/assets/app.js', { ok: true })).toBeUndefined();
  });

  it('支持对象与函数形式，函数返回空值时沿用原逻辑', () => {
    expect(resolveApiFallback('/api/system/info', { success: true })).toEqual({ success: true });
    expect(resolveApiFallback('/api/system/info', (url) => (url.includes('system') ? { data: 1 } : undefined))).toEqual({ data: 1 });
    expect(resolveApiFallback('/api/other', (url) => (url.includes('system') ? { data: 1 } : undefined))).toBeUndefined();
  });

  it('支持自定义前缀', () => {
    expect(resolveApiFallback('/v1/ping', { ok: 1 }, '/v1/')).toEqual({ ok: 1 });
  });
});

describe('内置静态服务', () => {
  let rootDir = '';
  let server: StaticServer | null = null;

  beforeAll(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-kit-api-'));
    fs.writeFileSync(path.join(rootDir, 'index.html'), '<html><body>shell</body></html>');
    server = await createStaticServer({
      root: rootDir,
      apiFallback: (url) => (url.includes('/system/info') ? { success: true, data: {} } : undefined),
    });
  });

  afterAll(async () => {
    await server?.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('命中的接口应返回兜底 JSON，而不是 index.html', async () => {
    const res = await fetch(`${server?.url}/api/system/info`);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ success: true, data: {} });
  });

  it('未兜底的接口应回退到 SPA 入口', async () => {
    const res = await fetch(`${server?.url}/api/unknown`);
    expect(await res.text()).toContain('shell');
  });

  it('普通页面请求不受影响', async () => {
    const res = await fetch(`${server?.url}/about`);
    expect(await res.text()).toContain('shell');
  });
});
