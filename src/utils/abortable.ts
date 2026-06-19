/**
 * sleep abortável — o cooldown da Azul (180s) é um job "running" dormindo;
 * sem isto, um cancel só agiria depois do sleep (features.md §15.4).
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** true se o erro veio de um AbortController/AbortSignal. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
