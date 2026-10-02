/**
 * Who is calling right now. Services that isolate data per user (connectors, chats)
 * read this instead of threading the Fastify request through every method.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestActor = {
  /** Org employee seat id; null for the account owner / non-org callers. */
  employeeId: string | null;
  /** Family seat the session is bound to (seat login); null for the owner's own session. */
  seatMemberId?: string | null;
};

const storage = new AsyncLocalStorage<RequestActor>();

/** Run the rest of the request lifecycle inside this actor's context. */
export function runWithRequestActor(actor: RequestActor, next: () => void): void {
  storage.run(actor, next);
}

export function currentRequestActor(): RequestActor {
  return storage.getStore() ?? { employeeId: null, seatMemberId: null };
}

/** Run async work (e.g. a webhook delivery) as a specific actor. */
export function withRequestActor<T>(actor: RequestActor, fn: () => Promise<T>): Promise<T> {
  return storage.run(actor, fn);
}
