import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildPageUrl,
  DEFAULT_MAX_AGE_MINUTES,
  defaultOutputFile,
  getMaxAgeMs,
  isRouteFresh,
  normalizeRoute,
  normalizeRoutes,
  resolveRoutes,
} from '../src/core/routes.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-kit-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 创建一个文件，并可指定其最后修改时间 */
function createFile(relativePath: string, minutesAgo?: number) {
  const file = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '<html></html>');
  if (typeof minutesAgo === 'number') {
    const time = new Date(Date.now() - minutesAgo * 60 * 1000);
    fs.utimesSync(file, time, time);
  }
  return file;
}

describe('normalizeRoute / normalizeRoutes', () => {
  it('应补齐前导斜杠并去除尾部斜杠', () => {
    expect(normalizeRoute('about')).toBe('/about');
    expect(normalizeRoute('/about/')).toBe('/about');
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('/404.html')).toBe('/404.html');
    expect(normalizeRoute('/about#top')).toBe('/about');
  });

  it('应保持顺序并去重', () => {
    expect(normalizeRoutes(['/a/', '/a', 'b/', '/c#x'])).toEqual(['/a', '/b', '/c']);
  });
});

describe('defaultOutputFile', () => {
  it('应生成 <outDir>/<route>/index.html', () => {
    expect(defaultOutputFile('/', '/dist')).toBe(path.join('/dist', '/', 'index.html'));
    expect(defaultOutputFile('/zh/about', '/dist')).toBe(path.join('/dist', '/zh/about', 'index.html'));
  });

  it('以 .html 结尾的路由应直接作为文件名', () => {
    expect(defaultOutputFile('/404.html', '/dist')).toBe(path.join('/dist', '404.html'));
  });

  it('含 query 参数或空路由应返回空字符串', () => {
    expect(defaultOutputFile('/list?page=1', '/dist')).toBe('');
    expect(defaultOutputFile('', '/dist')).toBe('');
  });
});

describe('getMaxAgeMs', () => {
  it('默认 60 分钟', () => {
    expect(getMaxAgeMs()).toBe(DEFAULT_MAX_AGE_MINUTES * 60 * 1000);
    expect(getMaxAgeMs(undefined)).toBe(DEFAULT_MAX_AGE_MINUTES * 60 * 1000);
  });

  it('非法值回退为默认值', () => {
    expect(getMaxAgeMs(-1)).toBe(DEFAULT_MAX_AGE_MINUTES * 60 * 1000);
    expect(getMaxAgeMs(Number.NaN)).toBe(DEFAULT_MAX_AGE_MINUTES * 60 * 1000);
    expect(getMaxAgeMs('abc' as unknown as number)).toBe(DEFAULT_MAX_AGE_MINUTES * 60 * 1000);
  });

  it('0 表示总是过期', () => {
    expect(getMaxAgeMs(0)).toBe(0);
  });
});

describe('isRouteFresh', () => {
  it('文件不存在时返回 false', () => {
    expect(isRouteFresh(path.join(tmpDir, 'not-exists/index.html'))).toBe(false);
  });

  it('新文件在有效期内', () => {
    const file = createFile('fresh/index.html', 1);
    expect(isRouteFresh(file)).toBe(true);
  });

  it('超时文件视为过期', () => {
    const file = createFile('expired/index.html', 120);
    expect(isRouteFresh(file)).toBe(false);
    expect(isRouteFresh(file, false, 180)).toBe(true);
  });

  it('force 为 true 时始终返回 false', () => {
    const file = createFile('force/index.html', 0);
    expect(isRouteFresh(file, true)).toBe(false);
  });
});

describe('resolveRoutes', () => {
  it('应正确分类 pending / skipped / expired / invalid', () => {
    createFile('out/a/index.html', 1);
    createFile('out/b/index.html', 120);

    const result = resolveRoutes(['/a', '/b', '/c', '/list?page=1'], path.join(tmpDir, 'out'), { maxAge: 60 });

    expect(result.skipped).toEqual(['/a']);
    expect(result.expired).toEqual(['/b']);
    expect(result.pending).toEqual(['/b', '/c']);
    expect(result.invalid).toEqual(['/list?page=1']);
  });

  it('force 为 true 时全部进入 pending', () => {
    createFile('out-force/a/index.html', 1);
    const result = resolveRoutes(['/a'], path.join(tmpDir, 'out-force'), { force: true });
    expect(result.pending).toEqual(['/a']);
    expect(result.skipped).toEqual([]);
  });
});

describe('buildPageUrl', () => {
  it('默认拼接 base 与 route', () => {
    expect(buildPageUrl('http://127.0.0.1:4173', '/', '/zh/about')).toBe('http://127.0.0.1:4173/zh/about');
  });

  it('支持子路径部署的 base', () => {
    expect(buildPageUrl('https://example.com/', '/sub/', '/about')).toBe('https://example.com/sub/about');
  });

  it('hash 路由模式', () => {
    expect(buildPageUrl('http://127.0.0.1:4173', '/', '/about', true)).toBe('http://127.0.0.1:4173/#/about');
  });
});
