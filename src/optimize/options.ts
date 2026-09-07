import type { HtmlOptimizeOptions } from '../types.js';

/** `optimize: true` 时启用的推荐组合 */
export const DEFAULT_OPTIMIZE_OPTIONS: Required<Omit<HtmlOptimizeOptions, 'loadingIndicator'>> & {
  loadingIndicator: false;
} = {
  removeInlineSvg: true,
  removeEmptyWrappers: false,
  removeInlineStyles: true,
  inlineStylesMinLength: 1000,
  removeClassAttributes: true,
  minify: true,
  loadingIndicator: false,
};

/**
 * 解析 optimize 配置。
 * - `false` / `undefined`：不启用
 * - `true`：启用推荐组合
 * - 对象：以推荐组合为基础做浅合并
 */
export function resolveOptimizeOptions(options?: boolean | HtmlOptimizeOptions): HtmlOptimizeOptions | null {
  if (options === false || options == null) return null;
  if (options === true) return { ...DEFAULT_OPTIMIZE_OPTIONS };
  return { ...DEFAULT_OPTIMIZE_OPTIONS, ...options };
}
