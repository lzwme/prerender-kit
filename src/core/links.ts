const ANCHOR_REG = /<a\b[^>]*>/gi;
const HREF_REG = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const TARGET_REG = /\starget\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const DOWNLOAD_REG = /\sdownload\b/i;

/** 非页面链接的协议前缀 */
const NON_PAGE_PROTOCOL_REG = /^(?:mailto:|tel:|sms:|javascript:|data:|#)/i;

/** 获取属性值（兼容单引号、双引号与无引号写法） */
function getAttrValue(match: RegExpMatchArray | null): string {
  if (!match) return '';
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

export interface ExtractLinksOptions {
  /** 站点地址，用于判断是否同源。提供后同源的绝对地址也会被收集 */
  baseUrl?: string;
  /** 自定义过滤，返回 false 则丢弃 */
  filter?: (url: string) => boolean;
}

/**
 * 从 HTML 中提取可用于继续预渲染的站内链接。
 *
 * 规则（与 vite-prerender-plugin 的 parseLinks 一致并有所增强）：
 * - 必须有 href，且不能带 download 属性；
 * - target 若存在则必须为 _self；
 * - 排除 mailto:/tel:/javascript:/# 等非页面链接；
 * - 默认仅保留站内链接（相对路径或与 baseUrl 同源），并剥离 query 与 hash。
 */
export function extractLinks(html: string, options: ExtractLinksOptions = {}): string[] {
  const { baseUrl, filter } = options;
  const origin = baseUrl ? safeOrigin(baseUrl) : '';
  const links: string[] = [];

  for (const anchor of html.match(ANCHOR_REG) || []) {
    if (DOWNLOAD_REG.test(anchor)) continue;

    const target = getAttrValue(anchor.match(TARGET_REG));
    if (target && target !== '_self') continue;

    const href = getAttrValue(anchor.match(HREF_REG));
    if (!href || NON_PAGE_PROTOCOL_REG.test(href)) continue;

    let path = href;
    if (/^[a-z][a-z\d+\-.]*:/i.test(href)) {
      // 绝对地址：仅在与站点同源时保留
      if (!origin || safeOrigin(href) !== origin) continue;
      try {
        path = new URL(href).pathname + new URL(href).search;
      } catch {
        continue;
      }
    }

    // 剥离 query 与 hash：含 query 的路由无法静态化
    path = path.split('#')[0].split('?')[0];
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.length > 1 && !path.endsWith('.html')) path = path.replace(/\/+$/, '');
    if (!path || path === '/') continue;

    if (filter && !filter(path)) continue;
    links.push(path);
  }

  return links;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
