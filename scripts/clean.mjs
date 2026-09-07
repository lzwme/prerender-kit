import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 使用 fs.rm 而非 trash-cli：跨平台且无需系统回收站，更适合 CI 与最小化依赖
// 注：本包为 ESM-only，早期版本曾有 dist/cjs 与 dist/esm 产物，一并清理
for (const target of ['dist', 'dist/cjs', 'dist/esm', 'coverage']) {
  const dir = path.join(rootDir, target);
  if (!fs.existsSync(dir)) continue;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    // 受管控的环境可能禁止删除操作，此时仅提示并继续，构建会覆盖同名产物
    console.warn(`[clean] 无法删除 ${target}，将直接覆盖构建: ${error.message}`);
  }
}

console.log('clean done');
