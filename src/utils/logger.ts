import type { Logger } from '../types.js';

const noop = () => {};

/**
 * 创建默认的日志实例。
 * @param prefix 日志前缀
 * @param enabled 为 false 时返回空实现（静默）
 */
export function createLogger(prefix = '[prerender-kit]', enabled = true): Logger {
  if (!enabled) return { info: noop, warn: noop, error: noop, debug: noop };

  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    debug: (...args: unknown[]) => {
      if (process.env.PRERENDER_KIT_DEBUG) console.log(prefix, '[debug]', ...args);
    },
  };
}

/**
 * 将 logger 配置规范化为 Logger 实例。
 * - `false` 表示静默
 * - 传入自定义对象时要求至少提供 `info` 方法，缺失的 warn/error 回退为 info
 * - 其它非法值（如 `true`）回退为默认实现
 */
export function resolveLogger(logger: Logger | false | undefined, prefix?: string): Logger {
  if (!logger || typeof logger !== 'object' || typeof logger.info !== 'function') return createLogger(prefix, logger !== false);

  const { info, warn, error, debug } = logger;
  const logInfo = (...args: unknown[]) => info.call(logger, ...args);

  return {
    info: logInfo,
    warn: typeof warn === 'function' ? (...args: unknown[]) => warn.call(logger, ...args) : logInfo,
    error: typeof error === 'function' ? (...args: unknown[]) => error.call(logger, ...args) : logInfo,
    debug: typeof debug === 'function' ? (...args: unknown[]) => debug.call(logger, ...args) : undefined,
  };
}
