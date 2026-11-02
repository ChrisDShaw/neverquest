// Background polling can be skipped; a deliberate user action must never be lost.
export class Requests {
  #tail = Promise.resolve();
  #count = 0;
  get busy() { return this.#count > 0; }
  run(action, { polling = false } = {}) {
    if (polling && this.busy) return Promise.resolve(null);
    this.#count++;
    const operation = this.#tail.catch(() => {}).then(action);
    this.#tail = operation.catch(() => {});
    return operation.finally(() => { this.#count--; });
  }
}
