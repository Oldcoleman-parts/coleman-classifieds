// Held buyer messages (`/app/messages`): the list, release and discard. The contact module
// owns the messages and the sending; this is the staff screen around it.
import {
  requireId,
  requireStaff,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { getMessageProvider } from "./providers.js";

const INTENTS = {
  release: { method: "release", action: "HeldMessageReleased" },
  discard: { method: "discard", action: "HeldMessageDiscarded" },
};
const NOT_SET_UP = "Buyer messages aren’t set up yet.";

/** The held messages waiting for staff, or `available: false` before contact is built. */
export async function loadMessagesScreen() {
  const provider = getMessageProvider();
  if (!provider) return { available: false, rows: [] };
  const held = await provider.listHeld();
  return {
    available: true,
    rows: held.map((message) => ({
      id: message.id,
      listingId: message.listingId,
      listingTitle: message.listingTitle ?? null,
      buyerName: message.buyerName,
      buyerEmail: message.buyerEmail,
      body: message.body,
      holdReasons: message.holdReasons ?? [],
      createdAt: new Date(message.createdAt).toISOString(),
    })),
  };
}

/**
 * Release or discard one held message (`intent`, `messageId`). A repeat does nothing more:
 * the message is sent once and audited once.
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<{ ok: true, intent: string, already: boolean } | { ok: false, message: string, status: number }>}
 */
export async function handleMessageAction(formData, actor) {
  const staff = requireStaff(actor);
  const intent = formData.get("intent");
  const chosen = typeof intent === "string" ? INTENTS[intent] : undefined;
  if (!chosen) return { ok: false, message: "Unknown action", status: 400 };
  const provider = getMessageProvider();
  if (!provider) return { ok: false, message: NOT_SET_UP, status: 404 };

  let messageId;
  try {
    messageId = requireId(formData.get("messageId"), "messageId");
  } catch (error) {
    if (error instanceof ValidationError)
      return { ok: false, message: "That message wasn’t found.", status: 400 };
    throw error;
  }

  const result = await provider[chosen.method](messageId, staff);
  // DECISION (F05-T2): console writes the staff audit entry once the owning module says the
  // message changed. Only the id is kept: never the message or the buyer's email.
  if (result.changed)
    await writeAudit({
      action: chosen.action,
      actor: staff,
      listingId: result.listingId ?? null,
      details: { messageId },
    });
  return { ok: true, intent, already: !result.changed };
}
