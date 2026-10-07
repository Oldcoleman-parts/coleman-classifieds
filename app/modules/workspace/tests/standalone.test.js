import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { loader } from "@/routes/proxy.seller.$token.jsx";
import { action as actionSold } from "@/routes/proxy.seller.$token_.sold.jsx";
import { action as actionRemove } from "@/routes/proxy.seller.$token_.remove.jsx";
import { action as actionStart } from "@/routes/proxy.seller.$token_.start.jsx";
import { action as actionSubmit } from "@/routes/proxy.seller.$token_.submit.jsx";
import { setUp, tearDown, sellerWith, call, SHOP } from "./helpers.js";

function signedRequest(path, init) {
  const params = {
    shop: SHOP,
    path_prefix: "/apps/classifieds",
    timestamp: String(Math.floor(Date.now() / 1000)),
    logged_in_customer_id: "",
  };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");
  const query = new URLSearchParams({ ...params, signature });
  return new Request(`https://app.example.test/proxy${path}?${query}`, init);
}

/** Assert that a response is a standalone seller page (reads body once). */
async function expectStandalone(response) {
  const body = await response.text();

  // Headers must be set correctly
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");

  // Must start with layout none
  expect(body.trim()).toMatch(/^{%\s*layout\s+none\s*%}/);

  // Must have standalone document structure
  expect(body).toContain("<!doctype html>");
  expect(body).toContain(`lang="en"`);
  expect(body).toContain('charset="utf-8"');
  expect(body).toContain('content="width=device-width, initial-scale=1"');
  expect(body).toContain('name="robots" content="noindex, nofollow"');
  expect(body).toContain('name="referrer" content="no-referrer"');
  expect(body).toContain("<title>");

  // Must not have any <script src> or stylesheet links to another origin
  expect(body).not.toMatch(/<script[^>]+src=/);
  expect(body).not.toMatch(/<link[^>]+rel="?stylesheet"?/);
  expect(body).not.toMatch(/@import\s+["']https?:\/\//);
  expect(body).not.toMatch(/url\s*\(\s*["']?https?:\/\//);

  return body;
}

describe("AC1: Workspace standalone pages", () => {
  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    tearDown();
  });

  it.each([
    ["INVITED", { status: "INVITED" }],
    [
      "DRAFT",
      {
        status: "DRAFT",
        draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ],
    ["SUBMITTED", { status: "SUBMITTED" }],
    [
      "CHANGES_REQUESTED",
      {
        status: "CHANGES_REQUESTED",
        correctionDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ],
    [
      "APPROVED_AWAITING_PAYMENT",
      {
        status: "APPROVED_AWAITING_PAYMENT",
        paymentDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ],
    [
      "LIVE",
      { status: "LIVE", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    ],
    [
      "PAUSED",
      {
        status: "PAUSED",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ],
  ])("AC1: %s listing page is standalone", async (_, listing) => {
    const seller = await sellerWith(listing);

    const response = await loader({
      request: signedRequest(`/seller/${seller.token}`),
      params: { token: seller.token },
    });

    const body = await expectStandalone(response);
    expect(response.status).toBe(200);
    expect(body).toMatch(/<h1>[^<]+<\/h1>/);
    // The progress steps mark exactly one current step.
    expect(body.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it("AC1: closed listing page is standalone", async () => {
    const seller = await sellerWith({ status: "SOLD" });

    const response = await loader({
      request: signedRequest(`/seller/${seller.token}`),
      params: { token: seller.token },
    });

    const body = await expectStandalone(response);
    expect(response.status).toBe(200);
    expect(body).toContain("This listing has ended");
    expect(body).not.toContain('cc-steps"');
  });

  it("AC1: confirmation page (sold) is standalone", async () => {
    const seller = await sellerWith({
      status: "LIVE",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const response = await call(actionSold, seller, {});

    const body = await expectStandalone(response);
    expect(body).toContain("Mark as sold");
  });

  it("AC1: confirmation page (remove) is standalone", async () => {
    const seller = await sellerWith({
      status: "LIVE",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const response = await call(actionRemove, seller, {});

    const body = await expectStandalone(response);
    expect(body).toContain("Remove your listing");
  });

  it("AC1: closed page after confirm is standalone", async () => {
    const seller = await sellerWith({
      status: "LIVE",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const response = await call(actionSold, seller, { confirm: "yes" });

    const body = await expectStandalone(response);
    expect(body).toContain("Congratulations on the sale");
  });

  it("AC1: POST without form token returns 403 as standalone", async () => {
    const seller = await sellerWith({
      status: "DRAFT",
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await call(actionStart, seller, {}, { csrf: false });

    expect(response.status).toBe(403);
    await expectStandalone(response);
  });

  it("AC1: the 422 re-render after an invalid save is standalone", async () => {
    const seller = await sellerWith({
      status: "DRAFT",
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = await call(actionSubmit, seller, { title: "" });

    expect(response.status).toBe(422);
    const body = await expectStandalone(response);
    expect(body).toContain("cc-error");
  });
});
