export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (reason: Error) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectAbort(new Error('OPERATION_TIMEOUT'));
  };
  if (parent?.aborted) throw new Error('OPERATION_TIMEOUT');
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
