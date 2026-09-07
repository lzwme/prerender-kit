import { afterEach, describe, expect, it } from 'vitest';
import type { PuppeteerLike } from '../src/core/renderer.js';
import { createPuppeteerRenderer, EXECUTABLE_PATH_ENV_KEYS, resolveExecutablePath } from '../src/core/renderer.js';

/** 记录 launch 参数的假 puppeteer 实现 */
function createFakePuppeteer(captured: Record<string, unknown>[]): PuppeteerLike {
  return {
    async launch(options?: Record<string, unknown>) {
      captured.push(options || {});
      return {
        async newPage() {
          return {
            async goto() {},
            async setViewport() {},
            async waitForSelector() {},
            async content() {
              return '<html><body>ok</body></html>';
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
}

const ENV_KEYS = [...EXECUTABLE_PATH_ENV_KEYS];
const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function setEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

describe('resolveExecutablePath', () => {
  it('未设置环境变量时应返回空字符串', () => {
    setEnv({});
    expect(resolveExecutablePath()).toBe('');
  });

  it('应按 PUPPETEER_EXECUTABLE_PATH > CHROME_EXECUTABLE_PATH > CHROME_EXECUTABLE 优先级读取', () => {
    setEnv({ CHROME_EXECUTABLE: '/bin/c3', CHROME_EXECUTABLE_PATH: '/bin/c2' });
    expect(resolveExecutablePath()).toBe('/bin/c2');

    setEnv({ CHROME_EXECUTABLE: '/bin/c3', CHROME_EXECUTABLE_PATH: '/bin/c2', PUPPETEER_EXECUTABLE_PATH: '/bin/c1' });
    expect(resolveExecutablePath()).toBe('/bin/c1');
  });

  it('应忽略空白值', () => {
    setEnv({ PUPPETEER_EXECUTABLE_PATH: '   ', CHROME_EXECUTABLE_PATH: '/bin/chrome' });
    expect(resolveExecutablePath()).toBe('/bin/chrome');
  });
});

describe('createPuppeteerRenderer', () => {
  it('未配置时不传 executablePath', async () => {
    setEnv({});
    const captured: Record<string, unknown>[] = [];
    const renderer = createPuppeteerRenderer({ puppeteerModule: createFakePuppeteer(captured) });

    await renderer.launch();
    expect(captured[0].executablePath).toBeUndefined();
    expect(captured[0].headless).toBe(true);
  });

  it('应从环境变量读取并设置 executablePath', async () => {
    setEnv({ CHROME_EXECUTABLE_PATH: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const captured: Record<string, unknown>[] = [];
    const renderer = createPuppeteerRenderer({ puppeteerModule: createFakePuppeteer(captured) });

    await renderer.launch();
    expect(captured[0].executablePath).toBe('C:/Program Files/Google/Chrome/Application/chrome.exe');
  });

  it('显式配置的 executablePath 应优先于环境变量', async () => {
    setEnv({ PUPPETEER_EXECUTABLE_PATH: '/env/chrome' });
    const captured: Record<string, unknown>[] = [];
    const renderer = createPuppeteerRenderer({
      puppeteerModule: createFakePuppeteer(captured),
      launchOptions: { executablePath: '/custom/chrome' },
    });

    await renderer.launch();
    expect(captured[0].executablePath).toBe('/custom/chrome');
  });

  it('launchOptions 的其它参数应保留', async () => {
    setEnv({});
    const captured: Record<string, unknown>[] = [];
    const renderer = createPuppeteerRenderer({
      puppeteerModule: createFakePuppeteer(captured),
      launchOptions: { args: ['--disable-gpu'], headless: 'shell' },
    });

    await renderer.launch();
    expect(captured[0].args).toEqual(['--disable-gpu']);
    expect(captured[0].headless).toBe('shell');
  });

  it('并发渲染时应按 url 隔离页面运行时错误', async () => {
    setEnv({});
    const renderer = createPuppeteerRenderer({
      puppeteerModule: {
        async launch() {
          return {
            async newPage() {
              return {
                on(event: string, handler: (...args: unknown[]) => void) {
                  if (event === 'pageerror') {
                    queueMicrotask(() => handler(new Error('boom')));
                  }
                },
                async goto(url: string) {
                  this.currentUrl = url;
                },
                currentUrl: '',
                async setViewport() {},
                async waitForSelector() {},
                async content() {
                  return `<html><body>${this.currentUrl}</body></html>`;
                },
                async close() {},
              };
            },
            async close() {},
          };
        },
      },
    });

    await renderer.launch();
    await Promise.all([renderer.render('http://127.0.0.1/a'), renderer.render('http://127.0.0.1/b')]);

    expect(renderer.drainErrors?.('http://127.0.0.1/a')).toEqual(['[pageerror] boom']);
    expect(renderer.drainErrors?.('http://127.0.0.1/b')).toEqual(['[pageerror] boom']);
    expect(renderer.drainErrors?.('http://127.0.0.1/a')).toEqual([]);
  });
});
