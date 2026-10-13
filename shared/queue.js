// Paid requests run one at a time, with a cap on how many may wait.
import { UserError } from "./settings.js";
/** `signal.throwIfAborted()`, which Safari before 17.4 lacks. */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("작업을 취소했습니다.", "AbortError");
}
export class WorkQueue {
  tail = Promise.resolve();
  waiting = 0;
  active = false;
  async run(job, signal) {
    if (this.waiting >= 20)
      throw new UserError(
        "대기 중인 요청이 많습니다. 잠시 후 다시 시도해 주십시오.",
        429,
      );
    this.waiting++;
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    this.waiting--;
    this.active = true;
    try {
      throwIfAborted(signal);
      return await job();
    } finally {
      this.active = false;
      release();
    }
  }
}
