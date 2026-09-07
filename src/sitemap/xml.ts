import type { RobotsOptions, SitemapUrlEntry } from '../types.js';

const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** XML 转义。URL 中若含 & 等字符，未转义将生成非法的 sitemap */
export function escapeXml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => XML_ESCAPE_MAP[char] ?? char);
}

/** 生成 urlset XML */
export function buildUrlSetXml(entries: SitemapUrlEntry[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];

  for (const entry of entries) {
    lines.push('  <url>', `    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    if (typeof entry.priority === 'number') lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    for (const alt of entry.alternates || []) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>`);
    }
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

/** 生成 sitemap index XML（用于拆分大型站点） */
export function buildSitemapIndexXml(entries: { loc: string; lastmod?: string }[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];

  for (const entry of entries) {
    lines.push('  <sitemap>', `    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    lines.push('  </sitemap>');
  }

  lines.push('</sitemapindex>');
  return `${lines.join('\n')}\n`;
}

/** 生成 robots.txt 内容 */
export function buildRobotsTxt(options: RobotsOptions = {}): string {
  const rules = options.rules?.length ? options.rules : [{ userAgent: '*', allow: ['/'] }];
  const lines: string[] = [];

  for (const rule of rules) {
    lines.push(`User-agent: ${rule.userAgent || '*'}`);
    for (const item of rule.allow || []) lines.push(`Allow: ${item}`);
    for (const item of rule.disallow || []) lines.push(`Disallow: ${item}`);
    lines.push('');
  }

  if (options.host) lines.push(`Host: ${options.host}`, '');
  for (const sitemap of options.sitemaps || []) lines.push(`Sitemap: ${sitemap}`);
  for (const extra of options.extra || []) lines.push(extra);

  return `${lines.join('\n').trimEnd()}\n`;
}
