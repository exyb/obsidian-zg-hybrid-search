export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export class OperationCancelledError extends Error {
  constructor(operation: string) {
    super(`${operation} was cancelled.`);
    this.name = 'OperationCancelledError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Runs trailing-edge debounced callbacks; only ever one pending timer. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  schedule(action: () => void, delayMs: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      action();
    }, Math.max(0, delayMs));
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get isPending(): boolean {
    return this.timer !== null;
  }
}
