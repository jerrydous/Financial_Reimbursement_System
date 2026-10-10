export const EXTERNAL_CALL_TIMEOUT_MS = 10_000;

/** 官方 SDK 自己没有超时参数时，用这一层限制等待。 */
export function withExternalDeadline<T>(work: Promise<T>, timeoutMs = EXTERNAL_CALL_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('EXTERNAL_TIMEOUT')), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
