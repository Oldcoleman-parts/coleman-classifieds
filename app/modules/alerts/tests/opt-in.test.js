import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeSubscriber,
  alertsTo,
  confirmGet,
  confirmPost,
  confirmTokenFor,
  freshWorld,
  goLive,
  oneClick,
  openListing,
  prisma,
  resubscribe,
  rowFor,
  setAlerts,
  signupPage,
  signUp,
  tearDown,
  unsubscribeGet,
  unsubscribeLinkFor,
} from "./helpers.js";

const EMAIL = "reader@example.test";

/** An active subscriber who has been sent an alert: returns its List-Unsubscribe URL. */
async function alertUnsubscribeUrl(ses) {
  await activeSubscriber(ses, EMAIL);
  await goLive(await openListing(), true);
  const [mail] = alertsTo(ses, EMAIL);
  const headers = mail.input.Content.Simple.Headers;
  const value = headers.find((h) => h.Name === "List-Unsubscribe").Value;
  return { url: value.replace(/^<|>$/g, ""), headers };
}

describe("Confirm and unsubscribe (F07-T2)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
  });

  afterEach(tearDown);

  it("AC: the confirm link shows a button and does not confirm", async () => {
    await signUp(EMAIL);
    const token = confirmTokenFor(ses, EMAIL);
    const res = await confirmGet(token);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="t"');
    expect((await rowFor(EMAIL)).confirmedAt).toBeNull();
  });

  it("AC: confirming with the button's POST makes the subscription active", async () => {
    await signUp(EMAIL);
    const res = await confirmPost(confirmTokenFor(ses, EMAIL));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("subscribed");
    expect((await rowFor(EMAIL)).confirmedAt).not.toBeNull();
  });

  it("AC: unsubscribe works from Gmail's one-click button (POST to the alert's link)", async () => {
    const { url, headers } = await alertUnsubscribeUrl(ses);
    const postHeader = headers.find((h) => h.Name === "List-Unsubscribe-Post");
    expect(postHeader.Value).toBe("List-Unsubscribe=One-Click");
    expect(new URL(url).searchParams.get("t")).toBeTruthy();

    const res = await oneClick(url);

    expect(res.status).toBe(200);
    expect((await rowFor(EMAIL)).unsubscribedAt).not.toBeNull();
  });

  it("AC: opening the unsubscribe link (GET) alone does not unsubscribe", async () => {
    const { url } = await alertUnsubscribeUrl(ses);
    const res = await unsubscribeGet(url);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Unsubscribe");
    expect((await rowFor(EMAIL)).unsubscribedAt).toBeNull();
  });

  it("AC: with alerts off, signup and resubscribe are 404 but unsubscribe still works", async () => {
    const row = await activeSubscriber(ses, EMAIL);
    await setAlerts(false);

    expect((await signupPage()).status).toBe(404);
    expect((await signUp("new@example.test")).status).toBe(404);
    expect((await resubscribe("x")).status).toBe(404);
    expect((await confirmGet("x")).status).toBe(404);

    const res = await oneClick(unsubscribeLinkFor(row.id));
    expect(res.status).toBe(200);
    expect((await rowFor(EMAIL)).unsubscribedAt).not.toBeNull();
    expect(
      await prisma.alertSubscriber.count({
        where: { email: "new@example.test" },
      }),
    ).toBe(0);
  });
});
