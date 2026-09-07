import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prerenderer } from '../src/core/prerenderer.js';
import { loadState, resolveSignature } from '../src/core/state.js';
import { createStaticServer } from '../src/core/static-server.js';
import type { PrerenderOptions, Renderer, StaticServer } from '../src/types.js';

let rootDir = '';
let server: StaticServer | null = null;

function createFetchRenderer(): Renderer {
  return {
    name: 'fetch-mock',
    async launch() {},
    async render(url: string) {
      return await (await fetch(url)).text();
    },
    async close() {},
  };
}

beforeAll(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-kit-resume-'));
  const siteDir = path.join(rootDir, 'site');
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<html><body><div id="app"></div></body></html>');
  server = await createStaticServer({ root: siteDir });
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

/** 只渲染白名单路由的渲染器，用于模拟「渲染到一半被中断」 */
function createPartialRenderer(failRoutes: string[]): Renderer {
  return {
    name: 'partial-mock',
    async launch() {},
    async render(url: string) {
      const pathname = new URL(url).pathname.replace(/\/$/, '') || '/';
      if (failRoutes.includes(pathname)) throw new Error(`interrupted: ${pathname}`);
      return await (await fetch(url)).text();
    },
    async close() {},
  };
}

function baseOptions(outDir: string, extra: Partial<PrerenderOptions> = {}): PrerenderOptions {
  return {
    routes: ['/', '/a', '/b', '/c'],
    outDir,
    baseUrl: server?.url,
    renderer: createFetchRenderer(),
    logger: false,
    resume: true,
    ...extra,
  };
}

/** 模拟构建产物：assets 文件名自带 content hash，是指纹来源（预渲染不会改动它） */
function createBuildAssets(outDir: string, hash = 'aaa111'): void {
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'assets', `app-${hash}.js`), 'console.log(1)');
}

describe('断点续传', () => {
  it('中断后再次运行应只渲染未完成的路由', async () => {
    const outDir = path.join(rootDir, 'out-interrupted');
    createBuildAssets(outDir);

    // 第一次：/b 与 /c 渲染失败，模拟进程中断
    const first = await new Prerenderer(baseOptions(outDir, { renderer: createPartialRenderer(['/b', '/c']) })).render();
    expect(first.rendered.sort()).toEqual(['/', '/a']);
    expect(first.failed.sort()).toEqual(['/b', '/c']);

    // 第二次：正常渲染，应只处理上次未完成的两个
    const second = await new Prerenderer(baseOptions(outDir)).render();
    expect(second.resumed.sort()).toEqual(['/', '/a']);
    expect(second.rendered.sort()).toEqual(['/b', '/c']);
    expect(second.failed).toEqual([]);

    // 第三次：全部命中状态，不再渲染
    const third = await new Prerenderer(baseOptions(outDir)).render();
    expect(third.resumed.length).toBe(4);
    expect(third.rendered).toEqual([]);
    expect(third.failed).toEqual([]);
  });

  it('状态应实时落盘，产物齐全', async () => {
    const outDir = path.join(rootDir, 'out-state-file');
    await new Prerenderer(baseOptions(outDir)).render();

    const stateFile = path.join(outDir, '.prerender-state.json');
    expect(fs.existsSync(stateFile)).toBe(true);

    const state = loadState(stateFile);
    expect(state?.version).toBe(1);
    expect(Object.keys(state?.routes || {}).sort()).toEqual(['/', '/a', '/b', '/c']);
    expect(Object.values(state?.routes || {}).every((item) => item.status === 'done')).toBe(true);
  });

  it('构建产物变化时（assets hash 不同）应全量重新渲染', async () => {
    const outDir = path.join(rootDir, 'out-signature');
    createBuildAssets(outDir, 'aaa111');
    await new Prerenderer(baseOptions(outDir)).render();

    // 指纹一致：继续复用
    const same = await new Prerenderer(baseOptions(outDir)).render();
    expect(same.resumed.length).toBe(4);
    expect(same.rendered).toEqual([]);

    // 重新构建后 hash 变化：状态失效，全量重渲染
    fs.rmSync(path.join(outDir, 'assets', 'app-aaa111.js'));
    createBuildAssets(outDir, 'bbb222');
    const changed = await new Prerenderer(baseOptions(outDir)).render();
    expect(changed.resumed).toEqual([]);
    expect(changed.rendered.length).toBe(4);
  });

  it('显式 buildId 变化时应全量重新渲染', async () => {
    const outDir = path.join(rootDir, 'out-build-id');
    await new Prerenderer(baseOptions(outDir, { buildId: 'v1' })).render();

    const changed = await new Prerenderer(baseOptions(outDir, { buildId: 'v2' })).render();
    expect(changed.resumed).toEqual([]);
    expect(changed.rendered.length).toBe(4);

    const same = await new Prerenderer(baseOptions(outDir, { buildId: 'v2' })).render();
    expect(same.resumed.length).toBe(4);
  });

  it('force 为 true 时应忽略断点状态', async () => {
    const outDir = path.join(rootDir, 'out-force');
    await new Prerenderer(baseOptions(outDir)).render();

    const result = await new Prerenderer(baseOptions(outDir, { force: true })).render();
    expect(result.resumed).toEqual([]);
    expect(result.rendered.length).toBe(4);
  });

  it('产物被删除时应重新渲染该路由', async () => {
    const outDir = path.join(rootDir, 'out-deleted');
    await new Prerenderer(baseOptions(outDir)).render();

    fs.rmSync(path.join(outDir, 'b', 'index.html'));

    const result = await new Prerenderer(baseOptions(outDir)).render();
    expect(result.resumed.sort()).toEqual(['/', '/a', '/c']);
    expect(result.rendered).toEqual(['/b']);
  });

  it('产物被外部改写时应重新渲染（如构建覆盖了 index.html）', async () => {
    const outDir = path.join(rootDir, 'out-overwritten');
    await new Prerenderer(baseOptions(outDir)).render();

    // 模拟重新构建：覆写根 index.html（即路由 / 的产物）
    const rootHtml = path.join(outDir, 'index.html');
    fs.writeFileSync(rootHtml, '<html><body>rebuilt by vite</body></html>');

    const result = await new Prerenderer(baseOptions(outDir)).render();
    expect(result.resumed.sort()).toEqual(['/a', '/b', '/c']);
    expect(result.rendered).toEqual(['/']);
  });

  it('未开启 resume 时不应写入状态文件', async () => {
    const outDir = path.join(rootDir, 'out-no-resume');
    await new Prerenderer({ ...baseOptions(outDir), resume: false }).render();
    expect(fs.existsSync(path.join(outDir, '.prerender-state.json'))).toBe(false);
  });

  it('状态文件被写坏时应安全降级为全量渲染', async () => {
    const outDir = path.join(rootDir, 'out-corrupted');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, '.prerender-state.json'), '{ not json');

    const result = await new Prerenderer(baseOptions(outDir)).render();
    expect(result.resumed).toEqual([]);
    expect(result.rendered.length).toBe(4);
  });
});

describe('resolveSignature', () => {
  it('buildId 优先，且相同输入得到相同结果', () => {
    expect(resolveSignature('/tmp', 'abc')).toBe('id:abc');
    expect(resolveSignature('/tmp', 'abc')).toBe(resolveSignature('/tmp', 'abc'));
  });

  it('assets 变化应导致指纹变化', () => {
    const dir = path.join(rootDir, 'sig');
    const assets = path.join(dir, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, 'index-aaa.js'), 'a');

    const before = resolveSignature(dir);
    expect(before).not.toBe('');

    fs.writeFileSync(path.join(assets, 'index-bbb.js'), 'b');
    expect(resolveSignature(dir)).not.toBe(before);
  });
});
