import fs from 'node:fs';
import path from 'node:path';

/** 递归创建目录（已存在时忽略） */
export function ensureDir(dir: string): void {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

/** 获取文件最后修改时间(ms)。文件不存在或读取失败时返回 -1 */
export function getMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

/** 写入文件，自动创建所在目录 */
export function writeFileSafe(file: string, content: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
}

/** 路径分隔符统一为 /，便于日志展示与跨平台比较 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 将所有路径分隔符统一后拼接，避免 windows 下出现混合分隔符 */
export function joinPosix(...segments: string[]): string {
  return toPosixPath(path.join(...segments));
}
