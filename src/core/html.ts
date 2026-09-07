import type { HtmlCallback } from '../types.js';

const INLINE_STYLE_REG = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;

/** 移除 HTML 中的内联 <style> 标签 */
export function removeInlineStyle(html: string): string {
  return html.replace(INLINE_STYLE_REG, '');
}

/** 替换全部子串（无需转义正则，性能也更好） */
export function replaceAll(html: string, from: string, to = ''): string {
  return from ? html.split(from).join(to) : html;
}

export interface TransformHtmlOptions {
  /** 移除内联样式，默认 false，由调用方决定 */
  removeStyle?: boolean;
  /** 需要从 HTML 中移除的地址前缀列表，如本地预览服务的 http://127.0.0.1:4173 */
  replaceUrls?: string[];
  /** 自定义后处理 */
  callback?: HtmlCallback;
  /** 当前路由，传递给 callback */
  route: string;
}

/** 对渲染得到的 HTML 执行统一的后处理 */
export async function transformHtml(html: string, options: TransformHtmlOptions): Promise<string> {
  let content = options.removeStyle ? removeInlineStyle(html) : html;

  for (const url of options.replaceUrls || []) {
    const target = url.replace(/\/+$/, '');
    if (!target) continue;
    content = replaceAll(content, target);
    // 兼容协议相对地址的写法
    content = replaceAll(content, target.replace(/^https?:/, ''));
  }

  if (typeof options.callback === 'function') {
    const result = await options.callback(content, options.route);
    if (typeof result === 'string') content = result;
  }

  return content;
}
