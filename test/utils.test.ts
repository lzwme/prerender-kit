import { describe, expect, it } from 'vitest';
import { removeInlineStyle, replaceAll, transformHtml } from '../src/core/html.js';
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
