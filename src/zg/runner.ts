import { type ChildProcess, spawn } from 'node:child_process';
import { OperationCancelledError } from '../util/async';
import type { Toolchain } from './locate';

export interface RunOptions {
  cwd: string;
  /** Milliseconds before the child is killed; 0 disables the timeout. */
  timeoutMs?: number;
  /** Called once per stdout line for progress reporting. */
  onLine?: (line: string) => void;
  /**
   * Tasks sharing a key are mutually exclusive: starting a new one cancels
   * the previous run, which resolves with a cancelled outcome.
   */
  taskKey?: string;
}

export interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
}

const KILL_GRACE_MS = 5_000;

interface RunningTask {
  child: ChildProcess;
  taskKey: string;
  cancel: (timedOut: boolean) => void;
}

export class ZgRunner {
  private readonly running = new Map<number, RunningTask>();
  private nextId = 0;

  constructor(
    private readonly getToolchain: () => Promise<Toolchain>,
  ) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunOutcome> {
    const toolchain = await this.getToolchain();
    if (options.taskKey) this.cancelTask(options.taskKey);
    return new Promise<RunOutcome>((resolvePromise) => {
      const child = spawn(
        toolchain.command,
        [...toolchain.prefixArgs, ...args],
        {
          cwd: options.cwd,
          env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
          windowsHide: true,
          shell: false,
        },
      );
      const id = this.nextId;
      this.nextId += 1;
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let pendingLine = '';
      let settled = false;
      const stdoutText = (): string => stdoutChunks.join('');
      const stderrText = (): string => stderrChunks.join('');
      // zg prints command progress (scanning, model downloads) to stderr and
      // results to stdout; progress callbacks therefore watch both streams.
      const feedLine = (text: string): void => {
        if (!options.onLine) return;
        const parts = (pendingLine + text).split(/\r\n|\r|\n/);
        pendingLine = parts.pop() ?? '';
        for (const line of parts) options.onLine(line);
      };

      child.stdout?.on('data', (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        stdoutChunks.push(text);
        feedLine(text);
      });
      child.stderr?.on('data', (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        stderrChunks.push(text);
        feedLine(text);
      });

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: RunOutcome): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        this.running.delete(id);
        if (options.onLine && pendingLine.trim() && !outcome.cancelled) {
          options.onLine(pendingLine);
          pendingLine = '';
        }
        resolvePromise(outcome);
      };

      const task: RunningTask = {
        child,
        taskKey: options.taskKey ?? '',
        cancel: (timedOut: boolean) => {
          if (settled || child.killed) return;
          if (!child.pid) {
            finish({ code: null, stdout: '', stderr: '', cancelled: !timedOut, timedOut });
            return;
          }
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
          // Leave `settled` false; the close handler resolves with cancelled.
          child.once('close', (code) => finish({
            code,
            stdout: stdoutText(),
            stderr: stderrText(),
            cancelled: !timedOut,
            timedOut,
          }));
        },
      };
      this.running.set(id, task);

      const timeoutMs = options.timeoutMs ?? 0;
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => task.cancel(true), timeoutMs);
      }

      child.on('error', (error) => finish({
        code: null,
        stdout: stdoutText(),
        stderr: [stderrText(), String(error.message)].filter(Boolean).join('\n'),
        cancelled: false,
        timedOut: false,
      }));
      child.on('close', (code) => finish({
        code,
        stdout: stdoutText(),
        stderr: stderrText(),
        cancelled: false,
        timedOut: false,
      }));
    });
  }

  cancelTask(taskKey: string): void {
    for (const task of [...this.running.values()]) {
      if (task.taskKey === taskKey) task.cancel(false);
    }
  }

  cancelAll(): void {
    for (const task of [...this.running.values()]) {
      task.cancel(false);
    }
  }
}

/** Extracts zg's structured `Error: … / Code: …` blocks into one message. */
export function zgErrorMessage(outcome: RunOutcome): string | null {
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  const errorMatch = text.match(/^Error: (.+)$/m);
  if (!errorMatch) {
    if (outcome.code !== 0 && outcome.code !== null && outcome.stderr.trim()) {
      return outcome.stderr.trim();
    }
    return null;
  }
  const codeMatch = text.match(/^Code: (\S+)$/m);
  const detailMatch = text.match(/^Details:\n((?:  .+\n?)+)/m);
  const details = detailMatch?.[1]
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' · ');
  return [
    errorMatch[1],
    codeMatch ? `(${codeMatch[1]})` : null,
    details,
  ].filter(Boolean).join(' ');
}

export function assertOk(outcome: RunOutcome, label: string): RunOutcome {
  if (outcome.cancelled) {
    throw new OperationCancelledError(label);
  }
  if (outcome.timedOut) {
    throw new Error(`${label} timed out.`);
  }
  const message = zgErrorMessage(outcome);
  if (message) throw new Error(`${label}: ${message}`);
  return outcome;
}
