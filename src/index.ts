export { createRollupPlugin } from './adapters/rollup.js';
export { createVitePlugin, prerenderVite } from './adapters/vite.js';
export { createWebpackPlugin, PrerenderWebpackPlugin } from './adapters/webpack.js';
export { removeInlineStyle, transformHtml } from './core/html.js';
export { extractLinks } from './core/links.js';
export { Prerenderer, prerender, prerender as default, resolveOptions } from './core/prerenderer.js';
export type { BrowserLike, PageLike, PuppeteerLike, PuppeteerRendererOptions } from './core/renderer.js';
export { createPuppeteerRenderer, EXECUTABLE_PATH_ENV_KEYS, resolveExecutablePath, resolvePuppeteer } from './core/renderer.js';
export {
  buildPageUrl,
  DEFAULT_MAX_AGE_MINUTES,
  defaultOutputFile,
  getMaxAgeMs,
  isRouteFresh,
  normalizeRoute,
  normalizeRoutes,
  resolveRoutes,
} from './core/routes.js';
export {
  createState,
  DEFAULT_STATE_FILE,
  isRouteResumable,
  loadState,
  markStateRoute,
  resolveSignature,
  resolveStateFile,
  saveState,
} from './core/state.js';
export { createStaticServer } from './core/static-server.js';
export { createOptimizeStats, findHtmlFiles, mergeOptimizeStats, optimizeHtmlFiles } from './optimize/files.js';
export {
  addLoadingIndicator,
  DEFAULT_LOADING_INDICATOR,
  minifyHtml,
  optimizeHtml,
  preserveTagBlocks,
  removeClassAttributes,
  removeInlineStyles,
  removeInlineSvg,
} from './optimize/html.js';
export { DEFAULT_OPTIMIZE_OPTIONS, resolveOptimizeOptions } from './optimize/options.js';
export { collectRoutesFromDir, fileToRoute, generateSitemap } from './sitemap/generate.js';
export { buildRobotsTxt, buildSitemapIndexXml, buildUrlSetXml, escapeXml } from './sitemap/xml.js';
export * from './types.js';
export { runConcurrency } from './utils/concurrency.js';
export { isExcluded } from './utils/filter.js';
export { getMtimeMs, writeFileAtomic, writeFileSafe } from './utils/fs.js';
export { createLogger, resolveLogger } from './utils/logger.js';
