import { AsyncLocalStorage } from "node:async_hooks";

export class EmailPreparationBusy extends Error {
  constructor() {
    super("Email preparation is busy. Retry shortly.");
  }
}
const scope = new AsyncLocalStorage<boolean>();
let active = 0;

/** No waiting payloads: acquire before loading photos/PDFs or a stored envelope. */
export async function withEmailPreparation<T>(
  work: () => Promise<T>,
): Promise<T> {
  if (scope.getStore()) return work();
  if (active >= 2) throw new EmailPreparationBusy();
  active++;
  try {
    return await scope.run(true, work);
  } finally {
    active--;
  }
}
