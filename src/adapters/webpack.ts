import { Prerenderer } from '../core/prerenderer.js';
import { createStaticServer } from '../core/static-server.js';
import type { StaticServer, WebpackCompilerLike, WebpackPrerenderOptions } from '../types.js';
import { resolveLogger } from '../utils/logger.js';

/**
 * webpack 预渲染插件。
 *
 * ```js
 * // webpack.config.js
 * const { PrerenderWebpackPlugin } = require('@lzwme/prerender-kit')
 *
 * module.exports = {
 *   plugins: [new PrerenderWebpackPlugin({ routes: ['/', '/about'] })],
 * }
 * ```
 *
 * outDir 默认取 compiler.outputPath。若配置了 baseUrl 则直接使用该地址，不再启动本地服务。
 */
export class PrerenderWebpackPlugin {
  readonly name = 'prerender-kit';

  private readonly options: WebpackPrerenderOptions;

  constructor(options: WebpackPrerenderOptions) {
    this.options = options;
  }

  apply(compiler: WebpackCompilerLike): void {
    const logger = resolveLogger(this.options.logger);

    compiler.hooks.afterEmit.tapPromise(this.name, async () => {
      const outDir = this.options.outDir || compiler.outputPath || compiler.options?.output?.path || '';
      if (!outDir) throw new Error('[prerender-kit] 未能获取 webpack output.path，请在插件配置中显式指定 outDir');

      let server: StaticServer | null = null;
      try {
        server = this.options.baseUrl
          ? null
          : await createStaticServer({ root: this.options.staticDir || outDir, base: this.options.base, logger });
        await new Prerenderer({ ...this.options, outDir, baseUrl: this.options.baseUrl ?? server?.url }).render();
      } finally {
        await server?.close();
      }
    });
  }
}

/** 工厂方法，风格上与 createVitePlugin / createRollupPlugin 保持一致 */
export function createWebpackPlugin(options: WebpackPrerenderOptions): PrerenderWebpackPlugin {
  return new PrerenderWebpackPlugin(options);
}
