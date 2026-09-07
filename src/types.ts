/**
 * @lzwme/prerender-kit 公共类型定义
 *
 * 设计要点：
 * - 核心层不依赖任何构建工具，vite / webpack / rollup 等仅作为薄适配层存在；
 * - 渲染器(Renderer)为接口抽象，默认提供 puppeteer 实现，可替换为 playwright 等；
 * - 适配器返回最小化结构类型，避免对 vite / webpack 类型的强依赖。
 */

/** 日志接口。可传入自定义实现（如 pino、consola），传入 false 则静默 */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

/** 单个页面的渲染参数 */
export interface RenderOptions {
  /** 页面加载完成后的额外等待时间(ms)，用于等待异步数据渲染完成 */
  delay?: number;
  /** 页面导航等待策略，语义同 puppeteer 的 waitUntil。需等待异步接口时可设置为 networkidle0 */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** 渲染前等待出现的元素选择器，默认 body */
  waitForSelector?: string;
  /** 视口大小，默认 1024x768 */
  viewport?: { width: number; height: number };
}

/** 渲染器接口。默认基于 puppeteer 实现，可自定义（如 playwright） */
export interface Renderer {
  /** 渲染器名称，用于日志输出 */
  name?: string;
  /** 启动浏览器(或客户端)，渲染开始前调用一次 */
  launch(): Promise<void>;
  /** 渲染指定 url，返回完整的 HTML 字符串 */
  render(url: string, options?: RenderOptions): Promise<string>;
  /**
   * 取出指定页面（按 url）或最近一次渲染收集到的页面运行时错误（可选实现）。
   * 并发渲染时应传入 url，避免错误串扰到其它路由。
   */
  drainErrors?(url?: string): string[];
  /** 渲染结束后调用一次，用于释放资源 */
  close(): Promise<void>;
}

/** 渲染器工厂。用于延迟创建渲染器 */
export type RendererFactory = () => Renderer | Promise<Renderer>;

/** HTML 后处理回调。返回字符串则替换原内容，返回空则保持原样 */
// biome-ignore lint/suspicious/noConfusingVoidType: 此处 void 用于允许「无返回值」的回调写法
export type HtmlCallback = (html: string, route: string) => string | void | Promise<string | void>;

/** 产物文件路径解析。返回空字符串表示该路由无效、将被跳过 */
export type OutputFileResolver = (route: string, outDir: string) => string;

/** 断点续传配置 */
export interface ResumeOptions {
  /** 状态文件路径。默认 `<outDir>/.prerender-state.json` */
  file?: string;
}

/** 状态文件中单个路由的记录 */
export interface PrerenderStateRoute {
  /** 已完成 / 上次失败（失败的下次运行会自动重试） */
  status: 'done' | 'failed';
  /** 产物文件路径 */
  file: string;
  /** 产物大小，用于校验产物完整性 */
  size: number;
  /** 产物最后修改时间 */
  mtime: number;
  /** 该记录的更新时间 */
  updatedAt: number;
  /** 失败原因（仅 status 为 failed 时存在） */
  error?: string;
}

/** 断点续传状态（可安全落盘为 JSON） */
export interface PrerenderState {
  version: 1;
  /**
   * 构建指纹。指纹变化意味着构建产物已更新，已有状态全部失效并全量重渲染。
   * 默认根据 `<outDir>/assets/` 文件名列表（自带 content hash）自动计算，也可通过 buildId 指定
   */
  signature: string;
  /** 产物输出目录 */
  outDir: string;
  /** 首次创建时间 */
  startedAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 路由 -> 记录 */
  routes: Record<string, PrerenderStateRoute>;
}

/** 预渲染配置 */
export interface PrerenderOptions extends RenderOptions {
  /** 需要预渲染的路由列表，如 ['/', '/zh', '/en/about'] */
  routes: string[];
  /** 预渲染产物输出目录 */
  outDir: string;
  /**
   * 已运行站点的访问地址，如 http://localhost:4173、https://example.com。
   * 设置后不再自动启动本地静态服务，适用于独立使用 / CI 场景
   */
  baseUrl?: string;
  /** 站点部署的 base 路径，默认 / */
  base?: string;
  /** 是否为 hash 路由模式。为 true 时访问地址为 <base>/#<route> */
  hashHistory?: boolean;
  /** 未提供 baseUrl 时，内置静态服务的根目录。默认取 outDir */
  staticDir?: string;
  /** 内置静态服务端口，默认随机可用端口 */
  staticPort?: number;
  /** 并发渲染数量，默认 5 */
  concurrency?: number;
  /** 是否强制重新渲染，忽略已存在的产物。默认 false */
  force?: boolean;
  /** 产物有效期(分钟)，默认 60。产物修改时间距今超过该值则重新渲染。设置 0 表示总是重新渲染 */
  maxAge?: number;
  /**
   * 断点续传：渲染被中断(崩溃 / Ctrl+C / CI 超时)后，再次运行可从上次进度继续。
   * 默认关闭。
   * - `true`：使用默认状态文件 `<outDir>/.prerender-state.json`
   * - 对象：自定义状态文件路径，详见 ResumeOptions
   *
   * 与 `maxAge` 的区别：`maxAge` 基于「产物修改时间」判断新旧，无法区分
   * 「本次构建渲染的」与「上次构建遗留的」；断点续传通过构建指纹确保
   * 只有同一份构建产物的路由才会被复用
   */
  resume?: boolean | ResumeOptions;
  /**
   * 构建指纹，用于断点续传的状态校验。指定后，该值变化会使已有状态失效并全量重渲染。
   * 未指定时自动根据 `<outDir>/assets/` 下的文件名列表计算（构建产物文件名自带 content hash）。
   * 刻意不包含入口 index.html——预渲染 `/` 会覆写该文件，纳入会导致同一份构建的两次运行指纹不同
   */
  buildId?: string;
  /** 是否移除页面中的内联 <style> 标签，默认 true */
  removeStyle?: boolean;
  /**
   * 是否移除产物中出现的「用于渲染的站点地址」（如 http://127.0.0.1:4173），默认 true。
   * 关闭后产物中将保留绝对地址
   */
  removeBaseUrl?: boolean;
  /** 额外需要从产物中移除的地址(或字符串)列表 */
  replaceUrl?: string | string[];
  /** HTML 落地前的自定义后处理 */
  callback?: HtmlCallback;
  /** 自定义渲染器(或工厂)。默认使用 puppeteer */
  renderer?: Renderer | RendererFactory;
  /** 自定义产物路径，默认 <outDir>/<route>/index.html */
  outputFile?: OutputFileResolver;
  /** 自定义日志实现，设置 false 则静默 */
  logger?: Logger | false;
  /**
   * 是否从渲染结果中自动发现站内链接并加入预渲染队列，默认 false。
   * 开启后只需配置少量入口路由，即可像爬虫一样自动覆盖整站
   */
  discoverLinks?: boolean;
  /** 自定义链接过滤，返回 false 则不加入预渲染队列。仅 discoverLinks 开启时生效 */
  discoverFilter?: (url: string) => boolean;
  /** 预渲染路由总数上限（含自动发现的路由）。默认 0 表示不限制 */
  maxRoutes?: number;
  /** 页面存在运行时错误时是否视为渲染失败，默认 false（仅记录到 pageErrors） */
  failOnPageError?: boolean;
  /**
   * 生成 sitemap.xml（及可选的 robots.txt）。默认关闭。
   * - `true`：基于本次预渲染的路由生成，需要 siteUrl（或 baseUrl）才能确定站点地址
   * - 对象：完整配置，详见 SitemapOptions
   */
  sitemap?: boolean | SitemapOptions;
  /**
   * HTML 瘦身(优化)。默认关闭。
   * - `true`：启用推荐组合（移除内联 SVG、大段内联样式、class 属性，并压缩 HTML）
   * - 对象：按需开启各项能力
   */
  optimize?: boolean | HtmlOptimizeOptions;
}

/** 首屏 loading 指示器配置 */
export interface LoadingIndicatorOptions {
  /** 注入位置的锚点，默认 `<div id="app">` */
  target?: string;
  /** 自定义指示器 HTML，默认使用内置的轻量指示器 */
  html?: string;
}

/** HTML 瘦身配置。所有能力默认关闭，需显式开启 */
export interface HtmlOptimizeOptions {
  /** 移除内联 SVG 图标（运行时由 JS 重新渲染） */
  removeInlineSvg?: boolean;
  /** 移除 SVG 后一并清理残留的空包裹层（如 `<div><div>`）。默认 false，避免误删结构 */
  removeEmptyWrappers?: boolean;
  /** 移除内联 `<style>` 块 */
  removeInlineStyles?: boolean;
  /** 内容长度超过该值的 `<style>` 才会被移除，用于保留 critical CSS。默认 1000，设置 0 则移除全部 */
  inlineStylesMinLength?: number;
  /** 移除标签上的 class 属性（客户端渲染时会重新写回） */
  removeClassAttributes?: boolean;
  /** 移除注释并压缩空白 */
  minify?: boolean;
  /** 注入首屏 loading 指示器 */
  loadingIndicator?: boolean | LoadingIndicatorOptions;
}

/** sitemap 支持的更新频率 */
export type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

/** sitemap 中的单条 url 记录 */
export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
  /** hreflang 多语言候选链接 */
  alternates?: { hreflang: string; href: string }[];
}

/** robots.txt 单组规则 */
export interface RobotsRule {
  /** 默认 `*` */
  userAgent?: string;
  allow?: string[];
  disallow?: string[];
}

/** robots.txt 配置 */
export interface RobotsOptions {
  /** 规则列表，默认 `[{ userAgent: '*', allow: ['/'] }]` */
  rules?: RobotsRule[];
  /** Sitemap 地址列表。未提供时自动使用生成的 sitemap */
  sitemaps?: string[];
  /** Host 声明（Yandex 支持） */
  host?: string;
  /** 额外附加的自定义行 */
  extra?: string[];
}

/** sitemap 生成配置 */
export interface SitemapOptions {
  /** 站点地址，如 https://example.com。必填，否则跳过生成 */
  siteUrl?: string;
  /**
   * 需要收录的路由。默认从 outDir 扫描已预渲染的 HTML 产物，
   * 这样可保证 sitemap 与实际产物一致（不会收录预渲染失败的页面）
   */
  routes?: string[];
  /** 产物目录：未提供 routes 时从该目录扫描 */
  outDir?: string;
  /** 输出文件路径，默认 <outDir>/sitemap.xml */
  outFile?: string;
  /** 站点 base 路径（子路径部署时使用） */
  base?: string;
  /** 需要排除的路由（字符串片段或正则），如登录、后台类页面 */
  exclude?: (string | RegExp)[];
  /** 默认优先级，默认 0.5 */
  defaultPriority?: number;
  /** 按基础路由配置优先级，也支持函数。i18n 站点无需为每种语言重复配置 */
  priority?: Record<string, number> | ((route: string) => number | undefined);
  /** 默认更新频率，默认 weekly */
  defaultChangeFreq?: ChangeFreq;
  /** 按基础路由配置更新频率，也支持函数 */
  changeFreq?: Record<string, ChangeFreq> | ((route: string) => ChangeFreq | undefined);
  /**
   * lastmod 策略，默认 file：优先取产物 HTML 的修改时间，缺失时回退为当天。
   * 可选值：`today` | `file` | `none` | 固定日期字符串(如 2026-01-01) | 自定义函数
   */
  lastmod?: 'today' | 'file' | 'none' | string | ((route: string) => string | undefined);
  /** 多语言列表，如 ['zh', 'en']。设置后自动输出 hreflang alternate 链接 */
  languages?: string[];
  /** 多语言路由拼接方式：prefix(/zh/about，默认) | suffix(/about-en) | 自定义函数 */
  languageRoute?: 'prefix' | 'suffix' | ((route: string, lang: string) => string);
  /** 是否输出 x-default 链接，默认 true */
  xDefault?: boolean;
  /** 单个 sitemap 文件的 URL 上限，默认 45000。设置为 0 表示不拆分 */
  maxUrlsPerFile?: number;
  /** 是否同时生成 robots.txt，默认 false。传对象可自定义规则 */
  robots?: boolean | RobotsOptions;
  /** 是否同时输出 .gz 压缩文件，默认 false */
  gzip?: boolean;
  /** 产物路径解析，用于取 lastmod。默认 <outDir>/<route>/index.html */
  outputFile?: OutputFileResolver;
  /** 日志实现，设置 false 可静默 */
  logger?: Logger | false;
}

/** sitemap 生成结果 */
export interface SitemapResult {
  /** 主文件（拆分时为 index 文件） */
  file: string;
  /** 实际写入的 sitemap 文件列表 */
  files: string[];
  /** sitemap index 文件，未拆分时为 undefined */
  index?: string;
  /** robots.txt 路径，未生成时为 undefined */
  robots?: string;
  /** 收录的 URL 数量 */
  urls: number;
}

/** HTML 瘦身统计信息 */
export interface HtmlOptimizeStats {
  files: number;
  sizeBefore: number;
  sizeAfter: number;
  svgRemoved: number;
  inlineStylesRemoved: number;
  classAttributesRemoved: number;
}

/** 默认值填充后的配置 */
export type ResolvedPrerenderOptions = PrerenderOptions & {
  base: string;
  concurrency: number;
  maxAge: number;
  waitForSelector: string;
  viewport: { width: number; height: number };
};

/** 路由分类结果 */
export interface ResolveRoutesResult {
  /** 需要渲染的路由（无产物或产物已过期） */
  pending: string[];
  /** 产物仍在有效期内、被跳过的路由 */
  skipped: string[];
  /** 产物已过期、将被重新渲染的路由 */
  expired: string[];
  /** 非法路由（含 query 参数等），无法生成静态产物 */
  invalid: string[];
}

/** 预渲染结果 */
export interface PrerenderResult extends ResolveRoutesResult {
  /** 参与处理的路由总数（含自动发现的路由） */
  total: number;
  /** 成功渲染的路由 */
  rendered: string[];
  /** 渲染失败的路由 */
  failed: string[];
  /** 渲染成功产出的文件路径 */
  files: string[];
  /** 通过链接发现而新增的路由（discoverLinks 开启时） */
  discovered: string[];
  /** 通过断点续传状态恢复、跳过渲染的路由（resume 开启时） */
  resumed: string[];
  /** 页面运行时错误：route -> 错误信息列表 */
  pageErrors: Record<string, string[]>;
  /** HTML 瘦身统计（仅开启 optimize 时存在） */
  optimize?: HtmlOptimizeStats;
  /** sitemap 生成结果（仅开启 sitemap 时存在） */
  sitemap?: SitemapResult;
  /** 耗时(ms) */
  duration: number;
}

/** vite 插件的最小结构（避免强依赖 vite 的类型定义，同时可直接用于 vite 的 plugins 配置） */
export interface VitePrerenderPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  apply?: 'build' | 'serve';
  applyToEnvironment?: (environment: { name?: string }) => boolean;
  configResolved?: (config: ViteResolvedConfigLike) => void;
  configurePreviewServer?: (server: { middlewares: { use(handler: (req: any, res: any, next: () => void) => void): void } }) => void;
  closeBundle?: () => void | Promise<void>;
}

/** vite resolvedConfig 的最小结构 */
export interface ViteResolvedConfigLike {
  root?: string;
  base?: string;
  mode?: string;
  build?: { outDir?: string };
  preview?: Record<string, unknown>;
}

/** vite 适配器的配置。outDir / base 可省略，自动从 vite 配置中获取 */
export type VitePrerenderOptions = Omit<PrerenderOptions, 'outDir'> & {
  outDir?: string;
  /**
   * `vite preview` 时未匹配到预渲染产物的回退路径，默认 /index.html。
   * 与预渲染产物形如 /about/index.html 的目录结构配合使用
   */
  previewFallback?: string;
};

/** webpack 钩子(Hook)的最小结构 */
export interface WebpackHookLike {
  tap(name: string, fn: (...args: any[]) => void): void;
  tapAsync(name: string, fn: (...args: any[]) => void): void;
  tapPromise(name: string, fn: (...args: any[]) => Promise<void>): void;
}

/** webpack Compiler 的最小结构 */
export interface WebpackCompilerLike {
  outputPath?: string;
  options?: { output?: { path?: string } };
  hooks: Record<string, WebpackHookLike> & { afterEmit: WebpackHookLike };
}

/** webpack 适配器的配置。outDir 可省略，自动取 compiler.outputPath */
export type WebpackPrerenderOptions = Omit<PrerenderOptions, 'outDir'> & { outDir?: string };

/** rollup 插件的最小结构 */
export interface RollupPluginLike {
  name: string;
  writeBundle?: (outputOptions: { dir?: string; file?: string }) => void | Promise<void>;
}

/** rollup 适配器的配置。outDir 可省略，自动取 writeBundle 的 outputOptions.dir */
export type RollupPrerenderOptions = Omit<PrerenderOptions, 'outDir'> & { outDir?: string };

/** 内置静态服务实例 */
export interface StaticServer {
  /** 访问地址，如 http://127.0.0.1:51789 */
  url: string;
  /** 实际监听的端口 */
  port: number;
  /** 关闭服务 */
  close(): Promise<void>;
}
