import { Prerenderer } from '../core/prerenderer.js';
import { createStaticServer } from '../core/static-server.js';
import type { RollupPluginLike, RollupPrerenderOptions, StaticServer } from '../types.js';
import { resolveLogger } from '../utils/logger.js';

/**
 * rollup 预渲染插件。
 *
 * ```js
 * // rollup.config.js
 * import { createRollupPlugin } from '@lzwme/prerender-kit'
 *
 * export default {
 *   output: { dir: 'dist' },
 *   plugins: [createRollupPlugin({ routes: ['/', '/about'] })],
 * }
 * ```
 *
 * outDir 默认取 writeBundle 钩子中的 outputOptions.dir。
 */
export function createRollupPlugin(options: RollupPrerenderOptions): RollupPluginLike {
  const logger = resolveLogger(options.logger);

  return {
    name: 'prerender-kit',
    async writeBundle(outputOptions) {
      const outDir = options.outDir || outputOptions?.dir || '';
      if (!outDir) throw new Error('[prerender-kit] 未能获取 rollup 输出目录，请在插件配置中显式指定 outDir');

      let server: StaticServer | null = null;
      try {
        server = options.baseUrl ? null : await createStaticServer({ root: options.staticDir || outDir, base: options.base, logger });
        await new Prerenderer({ ...options, outDir, baseUrl: options.baseUrl ?? server?.url }).render();
      } finally {
        await server?.close();
      }
    },
  };
}
