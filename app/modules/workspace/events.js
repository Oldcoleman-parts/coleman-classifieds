// What the workspace module listens to: staff decisions on a revision.
// DECISION (F04-FIX-1): handlers run in subscription order. Publishing (F06) must register after
// workspace, so it reads the title and description copied here (see app/bootstrap.server.js).
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { applyApproval, applyRejection } from "./services/revisions.js";

/** Called from `register()`. */
export function registerListeners() {
  subscribe(EVENTS.RevisionApproved, (payload, meta) =>
    applyApproval(payload, meta),
  );
  subscribe(EVENTS.RevisionRejected, (payload, meta) =>
    applyRejection(payload, meta),
  );
}
