import type { HtmlOptimizeOptions, HtmlOptimizeStats, LoadingIndicatorOptions } from '../types.js';

const DEFAULT_PRESERVE_PREFIX = '___PRESERVE_BLOCK_';
const PRESERVE_SUFFIX = '___';
const DEFAULT_STYLE_MIN_LENGTH = 1000;

export interface PreserveResult {
  html: string;
  restore: (html: string) => string;
}

/**
 * 保护指定标签块（如 script/style/pre），避免后续正则替换误伤其内部内容。
 * 返回替换后的 html 与可用于还原的 restore 函数。
 *
 * 相比原始实现增加了占位符冲突处理：若正文中已存在占位符前缀，会持续加长前缀直至不冲突。
 */
export function preserveTagBlocks(html: string, tags: readonly string[], options?: { placeholderPrefix?: string }): PreserveResult {
  if (tags.length === 0) return { html, restore: (s: string) => s };

  let prefix = options?.placeholderPrefix ?? DEFAULT_PRESERVE_PREFIX;
  while (html.includes(prefix)) prefix = `_${prefix}`;

  const preserved: string[] = [];
  const tagsPattern = tags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`<(${tagsPattern})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');

  const working = html.replace(re, (match) => {
    const index = preserved.length;
    preserved.push(match);
    return `${prefix}${index}${PRESERVE_SUFFIX}`;
  });

  return {
    html: working,
    restore: (s: string) => {
      let out = s;
      for (let i = 0; i < preserved.length; i++) {
        out = out.split(`${prefix}${i}${PRESERVE_SUFFIX}`).join(preserved[i] ?? '');
      }
      return out;
    },
  };
}

/**
 * 移除内联 SVG 图标（lucide-react 等运行时生成的图标，客户端渲染会自动写回）
 */
export function removeInlineSvg(html: string, options?: { removeEmptyWrappers?: boolean }): { html: string; count: number } {
  const svgPattern = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
  const matches = html.match(svgPattern);
  if (!matches?.length) return { html, count: 0 };

  let result = html.replace(svgPattern, '');
  // 移除 svg 后可能残留空的嵌套包裹层，按需清理（默认关闭，避免误删结构）。
  // 注意：这里只成对删除「确认为空」的 <div><div></div></div>，
  // 相比直接删除 <div><div> 的朴素做法不会产生标签不配对的问题
  if (options?.removeEmptyWrappers) result = result.split('<div><div></div></div>').join('');

  return { html: result, count: matches.length };
}

/**
 * 移除内联 <style> 块。仅移除内容长度超过 minLength 的块，用于保留 critical CSS。
 * 设置 minLength 为 0 可移除全部内联样式
 */
export function removeInlineStyles(html: string, minLength = DEFAULT_STYLE_MIN_LENGTH): { html: string; count: number } {
  const stylePattern = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let count = 0;

  const result = html.replace(stylePattern, (match) => {
    if (match.length > minLength) {
      count++;
      return '';
    }
    return match;
  });

  return { html: result, count };
}

/**
 * 移除所有标签的 class 属性（客户端渲染时会自动写回）。
 * 保护 script/style 内部内容，避免误伤 JS 字符串中的 class="xxx"
 */
export function removeClassAttributes(html: string): { html: string; count: number } {
  const { html: working, restore } = preserveTagBlocks(html, ['script', 'style'], {
    placeholderPrefix: '___PRESERVE_CLASS_',
  });

  let count = 0;
  const stripped = working.replace(/\sclass=(?:"[^"]*"|'[^']*')/gi, () => {
    count++;
    return '';
  });

  return { html: restore(stripped), count };
}

/**
 * 压缩 HTML：移除注释、合并空白。
 * 保护 script/style/pre/textarea，避免破坏脚本内容与预格式化文本
 */
export function minifyHtml(html: string): string {
  const { html: working, restore } = preserveTagBlocks(html, ['script', 'style', 'pre', 'textarea'], {
    placeholderPrefix: '___PRESERVE_MINIFY_',
  });

  const withoutComments = working.replace(/<!--[\s\S]*?-->/g, '');
  const minified = withoutComments.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

  return restore(minified);
}

/** 默认的首屏 loading 指示器 */
export const DEFAULT_LOADING_INDICATOR = [
  `<style>@keyframes p{to{transform:scale(2.5);opacity:.2}}</style>`,
  `<div style="position:fixed;inset:0;z-index:999999;background:#fff;display:grid;place-items:center">`,
  `<i style="width:18px;height:18px;background:#26f;border-radius:50%;animation:p .5s infinite alternate"></i>`,
  `</div>`,
].join('\n');

/** 在挂载点后注入 loading 指示器，避免首屏白屏闪烁 */
export function addLoadingIndicator(html: string, options: LoadingIndicatorOptions = {}): string {
  const target = options.target ?? '<div id="app">';
  if (!target || !html.includes(target)) return html;

  const indicator = options.html ?? DEFAULT_LOADING_INDICATOR;
  return html.replace(target, () => `${target}${indicator}`);
}

/** 按配置对单个 HTML 内容执行瘦身，返回处理后的内容与统计信息 */
export function optimizeHtml(html: string, options: HtmlOptimizeOptions = {}): { html: string; stats: HtmlOptimizeStats } {
  const sizeBefore = Buffer.byteLength(html, 'utf8');
  const stats: HtmlOptimizeStats = {
    files: 1,
    sizeBefore,
    sizeAfter: sizeBefore,
    svgRemoved: 0,
    inlineStylesRemoved: 0,
    classAttributesRemoved: 0,
  };

  let result = html;

  if (options.removeInlineSvg) {
    const { html: next, count } = removeInlineSvg(result, { removeEmptyWrappers: options.removeEmptyWrappers });
    result = next;
    stats.svgRemoved = count;
  }

  if (options.removeInlineStyles) {
    const { html: next, count } = removeInlineStyles(result, options.inlineStylesMinLength ?? DEFAULT_STYLE_MIN_LENGTH);
    result = next;
    stats.inlineStylesRemoved = count;
  }

  if (options.removeClassAttributes) {
    const { html: next, count } = removeClassAttributes(result);
    result = next;
    stats.classAttributesRemoved = count;
  }

  if (options.loadingIndicator) {
    result = addLoadingIndicator(result, options.loadingIndicator === true ? {} : options.loadingIndicator);
  }

  if (options.minify) result = minifyHtml(result);

  stats.sizeAfter = Buffer.byteLength(result, 'utf8');

  return { html: result, stats };
}
