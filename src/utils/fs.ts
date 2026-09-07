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

/**
 * 原子写入：先写临时文件再 rename 到目标路径。
 *
 * 预渲染耗时较长，进程被中断(崩溃 / Ctrl+C / CI 超时)时若直接写入，
 * 目标文件会残留半截 HTML，导致下次运行误判为「已渲染完成」。
 * 原子写入可保证产物只有「不存在」与「完整」两种状态。
 */
export function writeFileAtomic(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } catch (error) {
    // rmSync 的 force 选项：临时文件尚未创建成功时删除也不抛错
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/** 写入文件，自动创建所在目录。采用原子写入，避免中断时留下不完整产物 */
export function writeFileSafe(file: string, content: string): void {
  writeFileAtomic(file, content);
}

/** 路径分隔符统一为 /，便于日志展示与跨平台比较 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 将所有路径分隔符统一后拼接，避免 windows 下出现混合分隔符 */
export function joinPosix(...segments: string[]): string {
  return toPosixPath(path.join(...segments));
}
