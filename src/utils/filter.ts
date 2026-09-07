/** 判断路径(或路由)是否命中排除规则。统一转换为 / 分隔符后比较 */
export function isExcluded(value: string, exclude?: (string | RegExp)[]): boolean {
  if (!exclude?.length) return false;
  const normalized = value.replace(/\\/g, '/');
  return exclude.some((item) => (item instanceof RegExp ? item.test(normalized) : normalized.includes(item)));
}
