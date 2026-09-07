import fs from 'node:fs';
import path from 'node:path';
import type { HtmlOptimizeOptions, HtmlOptimizeStats, Logger } from '../types.js';
import { isExcluded } from '../utils/filter.js';
import { resolveLogger } from '../utils/logger.js';
import { optimizeHtml } from './html.js';

export interface OptimizeHtmlFilesOptions extends HtmlOptimizeOptions {
  /** 需要处理的目录（必填） */
  dir: string;
  /** 需要排除的文件路径片段或正则 */
  exclude?: (string | RegExp)[];
  /** 仅在体积变小时才写回文件。默认 true */
  writeOnlyWhenSmaller?: boolean;
  /** 日志实例，设置 false 可静默 */
  logger?: Logger | false;
}

/**
 * 递归查找目录下的所有 HTML 文件。
 */
export function findHtmlFiles(dir: string, exclude?: (string | RegExp)[]): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html') && !isExcluded(full, exclude)) {
        files.push(full);
      }
    }
  };

  walk(dir);
  return files;
}

/** 合并统计信息 */
export function mergeOptimizeStats(target: HtmlOptimizeStats, source: HtmlOptimizeStats): HtmlOptimizeStats {
  target.files += source.files;
  target.sizeBefore += source.sizeBefore;
  target.sizeAfter += source.sizeAfter;
  target.svgRemoved += source.svgRemoved;
  target.inlineStylesRemoved += source.inlineStylesRemoved;
  target.classAttributesRemoved += source.classAttributesRemoved;
  return target;
}

export function createOptimizeStats(): HtmlOptimizeStats {
  return {
    files: 0,
    sizeBefore: 0,
    sizeAfter: 0,
    svgRemoved: 0,
    inlineStylesRemoved: 0,
    classAttributesRemoved: 0,
  };
}

/**
 * 批量瘦身目录下的预渲染 HTML 文件。
 *
 * 可作为构建后的独立步骤使用（与预渲染解耦）：
 * ```ts
 * await optimizeHtmlFiles({ dir: 'dist', minify: true, removeClassAttributes: true })
 * ```
 */
export function optimizeHtmlFiles(options: OptimizeHtmlFilesOptions): HtmlOptimizeStats {
  const logger = resolveLogger(options.logger, '[prerender-kit:optimize]');
  const stats = createOptimizeStats();
  const { dir, exclude, writeOnlyWhenSmaller = true } = options;

  if (!fs.existsSync(dir)) {
    logger.error(`目录不存在: ${dir}`);
    return stats;
  }

  const files = findHtmlFiles(dir, exclude);
  if (!files.length) {
    logger.warn(`未找到 HTML 文件: ${dir}`);
    return stats;
  }

  for (const file of files) {
    try {
      const original = fs.readFileSync(file, 'utf8');
      const { html, stats: fileStats } = optimizeHtml(original, options);

      mergeOptimizeStats(stats, fileStats);

      if (writeOnlyWhenSmaller && fileStats.sizeAfter >= fileStats.sizeBefore) continue;

      fs.writeFileSync(file, html, 'utf8');
      const saved = fileStats.sizeBefore - fileStats.sizeAfter;
      const percent = fileStats.sizeBefore ? ((saved / fileStats.sizeBefore) * 100).toFixed(2) : '0';
      logger.info(
        `${path.relative(dir, file).replace(/\\/g, '/')}: ${(fileStats.sizeBefore / 1024).toFixed(2)}KB -> ` +
          `${(fileStats.sizeAfter / 1024).toFixed(2)}KB (节省 ${percent}%)`,
      );
    } catch (error) {
      logger.error(`处理失败: ${file}`, error);
    }
  }

  logger.info(
    `完成：${stats.files} 个文件，${(stats.sizeBefore / 1024 / 1024).toFixed(2)}MB -> ${(stats.sizeAfter / 1024 / 1024).toFixed(2)}MB，` +
      `移除 SVG ${stats.svgRemoved} 个、内联样式 ${stats.inlineStylesRemoved} 个、class 属性 ${stats.classAttributesRemoved} 个`,
  );

  return stats;
}
