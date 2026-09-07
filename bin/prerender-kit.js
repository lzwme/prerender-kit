#!/usr/bin/env node
/**
 * @lzwme/prerender-kit CLI 入口
 *
 * 本包为 ESM-only，bin 脚本同样以 ESM 方式加载产物
 */
import { run } from '../dist/cli.js';

run(process.argv).then(
  (code) => {
    process.exitCode = code || 0;
  },
  (error) => {
    console.error('[prerender-kit]', error);
    process.exitCode = 1;
  },
);
