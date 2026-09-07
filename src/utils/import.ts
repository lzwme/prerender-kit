/**
 * 动态 import 的统一封装。
 *
 * 本包为 ESM-only，产物中 `import()` 会保持原样（不会被降级为 require），
 * 因此可以直接加载 puppeteer、vite 这类 ESM 或 ESM-only 的包，
 * 无需再使用 `new Function('return import(...)')` 之类的间接手段。
 *
 * @param specifier 模块名
 */
export function dynamicImport<T = unknown>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}
