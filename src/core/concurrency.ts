/** A shared limiter bounds work across independently scheduled projects. */
export const createTaskLimiter = (concurrency: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) active--;
      else next();
    }
  };
};
