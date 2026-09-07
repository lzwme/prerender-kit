# @lzwme/prerender-kit

[![NPM version][npm-image]][npm-url]
[![node version][node-image]][node-url]
[![npm download][download-image]][download-url]
[![GitHub issues][issues-img]][issues-url]
[![GitHub stars][stars-img]][stars-url]

[npm-image]: https://img.shields.io/npm/v/@lzwme/prerender-kit.svg?style=flat-square
[npm-url]: https://npmjs.org/package/@lzwme/prerender-kit
[node-image]: https://img.shields.io/badge/node.js-%3E=_20.19-green.svg?style=flat-square
[node-url]: https://nodejs.org/download/
[download-image]: https://img.shields.io/npm/dm/@lzwme/prerender-kit.svg?style=flat-square
[download-url]: https://npmjs.org/package/@lzwme/prerender-kit
[issues-img]: https://img.shields.io/github/issues/lzwme/prerender-kit.svg
[issues-url]: https://github.com/lzwme/prerender-kit/issues
[stars-img]: https://img.shields.io/github/stars/lzwme/prerender-kit.svg
[stars-url]: https://github.com/lzwme/prerender-kit/stargazers

通用的 SPA 预渲染（SSG）工具包：基于无头浏览器将路由渲染为静态 HTML，用于 SEO 与首屏优化。

核心渲染逻辑与构建工具**完全解耦**——vite / webpack / rollup 仅作为薄适配层，同时提供 CLI 与编程式 API，可独立对接任意已运行的站点。

## 目录

- [快速开始](#快速开始)
- [功能特点](#功能特点)
- [如何选择使用方式](#如何选择使用方式)
- [安装](#安装)
- [使用方式](#使用方式)
- [配置参考](#配置参考)
- [进阶能力](#进阶能力)
- [环境与兼容性](#环境与兼容性)
- [附录](#附录)
- [开发](#开发)
- [License](#license)

## 快速开始

```bash
pnpm add -D @lzwme/prerender-kit puppeteer
```

```ts
// vite.config.ts
import { createVitePlugin } from '@lzwme/prerender-kit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    createVitePlugin({
      routes: ['/', '/about'],
      concurrency: 5,
    }),
  ],
});
```

构建完成后，插件会在 `closeBundle` 阶段自动启动预览服务、渲染路由并写入 `<outDir>/<route>/index.html`。

## 功能特点

- **构建工具无关**：核心 `Prerenderer` 不依赖任何构建工具，适配层遵循同一套约定
- **开箱即用**：`createVitePlugin` / `PrerenderWebpackPlugin` / `createRollupPlugin`
- **独立使用**：CLI 或 API 指定 `baseUrl` 即可预渲染（含已部署站点）
- **增量预渲染**：产物在有效期内自动跳过，支持 `force` 与 `maxAge`
- **断点续传**：渲染中断后再次运行可从上次进度继续，配合构建指纹避免复用陈旧产物
- **链接自动发现**：`discoverLinks` 从产物中提取站内链接，逐层扩散
- **一站式收尾**：可选 HTML 瘦身、sitemap / robots.txt 生成
- **页面错误可见**：收集 `pageerror` / `console.error`，可配置 `failOnPageError`
- **渲染器可替换**：默认 puppeteer（可选依赖），可接入 playwright、SSR 等
- **零依赖内置静态服务**：未配置 `baseUrl` 时自动启动
- **TypeScript + ESM-only**：完整类型定义，Node `>=20.19`

## 如何选择使用方式

| 场景 | 推荐方式 |
| --- | --- |
| Vite 项目构建后自动预渲染 | `createVitePlugin` |
| Webpack / Rollup 项目 | `PrerenderWebpackPlugin` / `createRollupPlugin` |
| 站点已部署或本地已有服务 | CLI：`prkit -u <url> -o <dir> ...` |
| CI 脚本、自定义流水线 | `prerender()` / `new Prerenderer()` |
| 仅优化已有 HTML / 生成 sitemap | `optimizeHtmlFiles()` / `generateSitemap()` |

## 安装

```bash
# 作为构建插件（项目内）
pnpm add -D @lzwme/prerender-kit puppeteer

# 作为 CLI 全局安装
pnpm add -g @lzwme/prerender-kit puppeteer

# npm / yarn 亦可
npm i -D @lzwme/prerender-kit puppeteer
```

> `puppeteer` 为可选 peer 依赖，仅在真正执行渲染时动态加载。若通过 `renderer` 注入自定义渲染器（如 playwright），可不安装 puppeteer。

### 指定浏览器可执行文件

未显式配置 `launchOptions.executablePath` 时，依次读取以下环境变量（命中即止）：

1. `PUPPETEER_EXECUTABLE_PATH`
2. `CHROME_EXECUTABLE_PATH`
3. `CHROME_EXECUTABLE`

```bash
export CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome
pnpm build
```

优先级：**显式配置 > 环境变量 > puppeteer 自带 Chromium**。`resolveExecutablePath()` 与 `EXECUTABLE_PATH_ENV_KEYS` 已导出，便于自定义渲染器复用。

## 使用方式

### Vite 插件

```ts
import { createVitePlugin } from '@lzwme/prerender-kit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    createVitePlugin({
      routes: ['/', '/about', '/zh', '/zh/about'],
      delay: 300,
      concurrency: 10,
      maxAge: 120, // 产物 2 小时内视为有效，跳过渲染

      renderer: undefined, // puppeteer 启动参数
    }),
  ],
});
```

`outDir` 与 `base` 默认从 vite 配置自动获取。插件优先使用 vite 的 `preview` API 提供访问地址，失败时回退内置静态服务，渲染完成后自动关闭。

### Webpack 插件

```js
const { PrerenderWebpackPlugin } = require('@lzwme/prerender-kit');

module.exports = {
  plugins: [
    new PrerenderWebpackPlugin({
      routes: ['/', '/about'],
      concurrency: 5,
    }),
  ],
};
```

`outDir` 默认取 `compiler.outputPath`，在 `afterEmit` 钩子中执行。

### Rollup 插件

```js
import { createRollupPlugin } from '@lzwme/prerender-kit';

export default {
  output: { dir: 'dist' },
  plugins: [createRollupPlugin({ routes: ['/', '/about'] })],
};
```

`outDir` 默认取 `writeBundle` 的 `outputOptions.dir`。

### CLI

命令名：`prerender-kit` 或别名 `prkit`。

```bash
# 对线上站点预渲染
prkit -u https://example.com -o ./dist / /about /product

# 对本地已启动的服务预渲染
prkit -u http://127.0.0.1:3000 -o ./dist -r routes.txt

# 未提供 baseUrl 时，以 static-dir 为根目录启动内置静态服务
prkit -o ./dist -s ./dist -n 8 --max-age 60 / /about

# 使用配置文件（可导出完整 PrerenderOptions）
prkit -c prerender.config.js
```

`routes.txt` 示例（`#` 开头为注释，也支持 `.json` 数组或 `.js` 导出数组）：

```
/
/about
/product/compress-image
```

常用 CLI 参数：`--force`、`--resume`、`--build-id <id>`、`--discover-links`、`--optimize`、`--sitemap --site-url <url>`、`--max-age 0`（每次全量渲染）。完整参数列表请运行 `prkit --help`。

### 编程式 API

```ts
import { Prerenderer, prerender } from '@lzwme/prerender-kit';

const result = await prerender({
  routes: ['/', '/about'],
  outDir: 'dist/web',
  baseUrl: 'https://example.com', // 不设置则自动启动内置静态服务
  concurrency: 10,
  maxAge: 60,
  delay: 300,
  callback: (html, route) => html.replace('<title></title>', `<title>${route}</title>`),
});

console.log(result.rendered, result.skipped, result.failed);
```

## 配置参考

以下参数适用于插件、CLI（`-c` 配置文件）与编程式 API，为同一份 `PrerenderOptions`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `routes` | `string[]` | 必填 | 需要预渲染的路由 |
| `outDir` | `string` | 必填（适配器可自动推断） | 产物输出目录 |
| `baseUrl` | `string` | - | 已运行站点的访问地址。设置后不再启动本地服务 |
| `base` | `string` | `/` | 站点部署的 base 路径 |
| `hashHistory` | `boolean` | `false` | hash 路由模式 |
| `staticDir` | `string` | `outDir` | 未提供 `baseUrl` 时内置静态服务的根目录 |
| `staticPort` | `number` | 随机 | 内置静态服务端口 |
| `concurrency` | `number` | `5` | 并发渲染数量 |
| `force` | `boolean` | `false` | 强制重新渲染，忽略已有产物 |
| `maxAge` | `number` | `60` | 产物有效期（分钟），`0` 表示总是重新渲染 |
| `resume` | `boolean \| ResumeOptions` | `false` | 断点续传，中断后从上次进度继续，详见 [断点续传](#断点续传) |
| `buildId` | `string` | 自动计算 | 构建指纹。变化时断点状态失效并全量重渲染 |
| `delay` | `number` | - | 页面加载完成后的额外等待（ms） |
| `waitUntil` | `string` | `domcontentloaded` | 页面等待策略，`networkidle0` 可等待异步接口 |
| `waitForSelector` | `string` | `body` | 渲染前等待出现的选择器 |
| `viewport` | `{width,height}` | `1024×768` | 视口大小 |
| `removeStyle` | `boolean` | `true` | 移除内联 `<style>` 标签 |
| `removeBaseUrl` | `boolean` | `true` | 移除产物中的渲染站点地址 |
| `replaceUrl` | `string \| string[]` | - | 额外需要从产物中移除的地址/字符串 |
| `discoverLinks` | `boolean` | `false` | 自动发现站内链接并加入预渲染队列 |
| `discoverFilter` | `(url) => boolean` | - | 自定义链接过滤 |
| `maxRoutes` | `number` | `0`（不限制） | 预渲染路由总数上限 |
| `failOnPageError` | `boolean` | `false` | 页面存在运行时错误时视为渲染失败 |
| `optimize` | `boolean \| HtmlOptimizeOptions` | `false` | HTML 瘦身，详见 [HTML 瘦身](#html-瘦身) |
| `sitemap` | `boolean \| SitemapOptions` | `false` | 生成 sitemap，详见 [Sitemap](#sitemap-与-robotstxt) |
| `callback` | `(html, route) => string \| void` | - | 产物落地前的自定义后处理 |
| `renderer` | `Renderer \| (() => Renderer)` | puppeteer | 自定义渲染器 |
| `outputFile` | `(route, outDir) => string` | `<outDir>/<route>/index.html` | 自定义产物路径，返回空字符串表示跳过 |
| `logger` | `Logger \| false` | console | 自定义日志，`false` 为静默 |

## 进阶能力

### 增量预渲染

预渲染通常是构建中最耗时的环节。默认策略下，产物存在**且**最后修改时间在 `maxAge` 分钟（默认 60）内则跳过该路由：

- 全部命中时，不会启动预览服务与浏览器，构建几乎零额外开销
- 部分命中时，仅渲染缺失与已过期的路由
- `force: true`（或 CLI `--force`）强制全量重新渲染
- `maxAge: 0`（或 CLI `--max-age 0`）表示每次都重新渲染

### 断点续传

路由数量多、单页渲染耗时长时，一次预渲染可能持续几十分钟。构建被 Ctrl+C、CI 超时或进程崩溃中断后，
`resume` 可让下一次运行从中断处继续，而不是从头再来：

```ts
await prerender({
  routes,
  outDir: 'dist/web',
  resume: true, // 状态文件默认 <outDir>/.prerender-state.json
  // buildId: process.env.GIT_COMMIT_SHA, // 建议 CI 显式指定
  // resume: { file: 'node_modules/.cache/prerender-kit/state.json' },
});
```

CLI：`prkit --resume [--build-id <id>] ...`

设计要点：

| 机制 | 说明 |
| --- | --- |
| 实时落盘 | 状态按时间节流实时写入，进程被强杀最多丢失最近 0.5 秒内完成的进度 |
| 原子写入 | 产物先写 `.tmp` 再 rename，中断不会留下半截 HTML 被误判为「已完成」 |
| 失败自动重试 | 上次失败的路由保持在队列中，下次运行自动重试 |
| 构建指纹 | `buildId` 或 `assets/` 文件名（自带 content hash）作为指纹，变化时状态失效并全量重渲染 |
| 产物校验 | 状态命中但产物文件被删除、或 mtime/size 与记录不一致（被外部改写）时，重新渲染该路由 |

开启 `resume` 后**以状态为唯一判据**，`maxAge` 不再参与判断（`maxAge` 仅在未开启 `resume` 时生效）。
这不是功能退化而是修正：新鲜度只能说明「文件新」，无法说明「是谁写的」，
典型场景就是 `/` 的产物等于构建入口 `index.html`——每次构建都会覆写它，
按新鲜度会永远判定为「已渲染」，导致首页始终拿不到预渲染内容。

> 为什么需要「构建指纹」：仅凭「产物存在」无法区分「本次构建渲染的」与「上次构建遗留的陈旧产物」。
> 指纹不一致时，即使产物仍在 `maxAge` 有效期内也会重新渲染。
>
> 指纹来源刻意**不包含** `<outDir>/index.html`——预渲染 `/` 会覆写该文件，
> 若纳入指纹会导致同一份构建的两次运行指纹不同、状态自我失效。
> 无 `assets/` 目录且未指定 `buildId` 时指纹为空，退化为「仅按完成状态续跑」，建议在 CI 显式传入 `buildId`。

相关 API 已导出：`loadState` / `saveState` / `createState` / `isRouteResumable` / `resolveSignature` / `resolveStateFile` / `writeFileAtomic`。

### 链接自动发现

开启 `discoverLinks` 后，只需配置入口路由，工具会像爬虫一样逐层发现站内链接：

```ts
await prerender({
  routes: ['/'],
  outDir: 'dist',
  baseUrl: 'https://example.com',
  discoverLinks: true,
  discoverFilter: (url) => !url.startsWith('/admin'),
  maxRoutes: 500,
});
```

执行策略：同一层内并发渲染，渲染完成后从产物中提取新链接作为下一层，直至没有新路由或达到上限。

链接发现规则：

- 必须有 `href`，不带 `download`，`target` 若存在则必须为 `_self`
- 排除 `mailto:` / `tel:` / `javascript:` / `#` 等非页面链接
- 默认仅保留站内链接，并剥离 `query` 与 `hash`
- 命中缓存而被跳过的路由，也会读取已有产物继续发现链接

`extractLinks(html, options)` 已单独导出，可在自定义 `callback` 或 SSR 渲染器中复用。

### 页面运行时错误

预渲染时页面报错往往被静默忽略，导致产物不完整却「构建成功」。本工具会收集 `pageerror` 与 `console.error`，输出到 `result.pageErrors`：

```ts
const result = await prerender({ routes, outDir, failOnPageError: true });
if (result.failed.length) process.exitCode = 1;
```

默认 puppeteer 渲染器在并发场景下按页面 URL 隔离错误归属。自定义渲染器实现 `drainErrors(url?)` 时，建议同样按 URL 区分，避免错误串扰。

### HTML 瘦身

预渲染产物常包含运行时会被重新生成的内容（内联 SVG、大段内联样式、class 属性、注释与空白）。开启 `optimize` 可在落盘前裁掉这些冗余：

```ts
// 推荐组合
await prerender({ routes, outDir, optimize: true });

// 按需组合
await prerender({
  routes,
  outDir,
  optimize: {
    removeInlineSvg: true,
    removeEmptyWrappers: false,
    removeInlineStyles: true,
    inlineStylesMinLength: 1000,
    removeClassAttributes: true,
    minify: true,
    loadingIndicator: { target: '<div id="app">' },
  },
});
```

| 开关 | 默认（启用 optimize 时） | 说明 |
| --- | --- | --- |
| `removeInlineSvg` | `true` | 移除 `<svg>...</svg>` |
| `removeEmptyWrappers` | `false` | 清理确认为空的成对包裹层 |
| `removeInlineStyles` | `true` | 移除超过阈值的 `<style>` |
| `inlineStylesMinLength` | `1000` | 设为 `0` 则移除全部内联样式 |
| `removeClassAttributes` | `true` | 移除 `class="..."`，保护 script/style 内部 |
| `minify` | `true` | 移除注释并压缩标签间空白 |
| `loadingIndicator` | `false` | 在挂载点后注入首屏 loading 指示器 |

也可作为**独立步骤**使用（与预渲染解耦）：

```ts
import { optimizeHtmlFiles } from '@lzwme/prerender-kit';

optimizeHtmlFiles({
  dir: 'dist/web',
  removeInlineSvg: true,
  removeClassAttributes: true,
  minify: true,
  exclude: [/static\//],
  writeOnlyWhenSmaller: true,
});
```

单项能力同样独立导出：`preserveTagBlocks` / `removeInlineSvg` / `removeInlineStyles` / `removeClassAttributes` / `minifyHtml` / `addLoadingIndicator` / `optimizeHtml`。

> `minify` 仅压缩标签之间的空白，文本节点内部的空白会保留。

### Sitemap 与 robots.txt

预渲染后工具已掌握全部路由与产物文件，正是生成 sitemap 的最佳时机：

```ts
await prerender({
  routes,
  outDir: 'dist',
  sitemap: {
    siteUrl: 'https://example.com',
    languages: ['zh', 'en', 'zh-TW'],
    priority: { '/': 1.0, '/image-compress': 0.9 },
    changeFreq: { '/': 'daily' },
    exclude: [/^\/admin/, '/login'],
    robots: { rules: [{ userAgent: '*', disallow: ['/admin'] }] },
    gzip: true,
  },
});
```

也可完全独立调用：

```ts
import { generateSitemap } from '@lzwme/prerender-kit';

// 不传 routes 时扫描 outDir 下的 HTML 产物
generateSitemap({ siteUrl: 'https://example.com', outDir: 'dist', languages: ['zh', 'en'] });
```

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `siteUrl` | - | 站点地址，必填 |
| `routes` | 扫描 `outDir` | 需要收录的路由 |
| `outDir` / `outFile` | `<outDir>/sitemap.xml` | 产物目录与输出文件 |
| `base` | `/` | 子路径部署时的 base |
| `exclude` | - | 排除规则（字符串或正则） |
| `priority` / `changeFreq` | `0.5` / `weekly` | 支持按基础路由的对象或函数 |
| `lastmod` | `file` | 取产物 HTML 修改时间；也可 `today` / `none` / 固定日期 / 函数 |
| `languages` | - | 多语言列表，输出 hreflang alternate |
| `languageRoute` | `prefix` | `prefix` / `suffix` / 自定义函数 |
| `xDefault` | `true` | 是否输出 `x-default` |
| `maxUrlsPerFile` | `45000` | 超出则拆分并生成 index；`0` 不拆分 |
| `robots` | `false` | 是否生成 robots.txt |
| `gzip` | `false` | 是否同时输出 `.gz` |

CLI：`--sitemap --site-url https://example.com --languages zh,en --robots`。

> 默认从产物目录扫描路由，避免收录预渲染失败的页面；`lastmod` 默认取产物文件真实修改时间。

### 自定义渲染器

渲染器只需实现 `Renderer` 接口。以下示例为 Playwright：

```ts
import type { Renderer } from '@lzwme/prerender-kit';

const playwrightRenderer = (): Renderer => {
  let browser: Awaited<ReturnType<typeof import('playwright').chromium.launch>> | undefined;
  return {
    name: 'playwright',
    async launch() {
      const { chromium } = await import('playwright');
      browser = await chromium.launch();
    },
    async render(url, options) {
      const page = await browser!.newPage();
      await page.goto(url, { waitUntil: options?.waitUntil });
      if (options?.delay) await new Promise((r) => setTimeout(r, options.delay));
      const html = await page.content();
      await page.close();
      return html;
    },
    async close() {
      await browser?.close();
    },
  };
};

await prerender({ routes, outDir, renderer: playwrightRenderer() });
```

若应用支持 SSR，也可完全跳过浏览器：

```ts
import { prerender } from '@lzwme/prerender-kit';

const ssrRenderer = (): Renderer => ({
  name: 'ssr',
  async launch() {},
  async render(url) {
    const { prerender: appPrerender } = await import('./dist-ssr/entry-server.js');
    const { html } = await appPrerender(new URL(url).pathname);
    return html;
  },
  async close() {},
});
```

## 环境与兼容性

### Node 版本

要求 **Node `>=20.19`**（见 `package.json` 的 `engines` 字段）。

### ESM-only

本包**仅提供 ESM 产物**：

- **ESM 项目**（推荐）：`import { createVitePlugin } from '@lzwme/prerender-kit'`
- **CJS 项目**：Node 20.19+ / 22.12+ 起 `require(esm)` 默认可用；更低版本需 `await import()`
- **TypeScript + CJS 配置**：建议改为 ESM 配置，或使用动态 `import()`

选择 ESM-only 的理由：避免双产物带来的「双包实例」问题；原生 `import()` 可正常加载 puppeteer、vite 等 ESM 包；与现代 Node 及 Vite 生态对齐。

## 附录

### 与 vite-prerender-plugin 的对比

[vite-prerender-plugin](https://github.com/preactjs/vite-prerender-plugin) 是同类方案中的优秀实现，二者定位互补：

| 维度 | vite-prerender-plugin | @lzwme/prerender-kit |
| --- | --- | --- |
| 渲染方式 | 进程内 SSR | 无头浏览器（默认 puppeteer，可替换） |
| 框架要求 | 应用需提供 prerender 入口 | 零要求，任意 SPA 均可 |
| 速度 | 快（无浏览器） | 较慢，可用增量缓解 |
| 构建工具 | 仅 vite | vite / webpack / rollup / CLI / API |
| 增量/缓存 | 无 | `force` / `maxAge` |
| 独立使用 | 不支持 | 支持（任意 `baseUrl`） |

### 从 vite-plugin-seo-prerender 迁移

| vite-plugin-seo-prerender | @lzwme/prerender-kit |
| --- | --- |
| `routes` | `routes` |
| `puppeteer` | `renderer` / `createPuppeteerRenderer({ launchOptions })` |
| `network: true` | `waitUntil: 'networkidle0'` |
| `removeStyle` | `removeStyle` |
| `delay` | `delay` |
| `concurrency` | `concurrency` |
| `callback` | `callback` |
| `hashHistory` | `hashHistory` |
| - | 新增 `baseUrl`、`force`、`maxAge`、`resume`、`buildId`、`outputFile`、`renderer` |

`publicHtml`、`scss` 等与预渲染无关的能力不再内置，建议交由 `callback` 或独立工具处理。

## 开发

```bash
corepack enable          # 首次启用，使用 pnpm@11
pnpm install
pnpm build               # 输出 ESM 产物到 dist/
pnpm test                # 单元测试（内置静态服务 + fetch 渲染器，无需 puppeteer）
pnpm lint                # biome 检查
pnpm check:tsc           # 类型检查
pnpm verify              # lint + 类型检查 + 测试
```

## License

[MIT](./LICENSE) © [renxia](https://lzw.me)
