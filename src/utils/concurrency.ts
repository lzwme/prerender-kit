/**
 * 固定并发度的任务执行器。
 * 与 Promise.allSettled 行为一致：单个任务失败不影响其它任务，结果按输入顺序返回。
 *
 * @param tasks 任务列表
 * @param limit 最大并发数
 */
export async function runConcurrency<T>(tasks: Array<() => Promise<T>>, limit = 5): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const size = Math.max(1, Math.min(limit, tasks.length || 1));
  await Promise.all(Array.from({ length: size }, () => worker()));

  return results;
}
