import { afterEach, describe, expect, it } from "vitest";
import { issueDeviceCredential } from "@/modules/access/index.js";
import { issueFormToken } from "@/modules/access/services/form-token.js";
import { pageScript } from "@/modules/workspace/services/page-script.js";
import { loader as page } from "@/routes/proxy.seller.$token.jsx";
import { action as draft } from "@/routes/proxy.seller.$token_.draft.jsx";
import { action as live } from "@/routes/proxy.seller.$token_.live.jsx";
import { action as revision } from "@/routes/proxy.seller.$token_.revision.jsx";
import { action as sold } from "@/routes/proxy.seller.$token_.sold.jsx";
import { action as submit } from "@/routes/proxy.seller.$token_.submit.jsx";
import { action as uploadUrl } from "@/routes/proxy.seller.$token_.upload-url.jsx";
import {
  call,
  COMPLETE,
  DAY_MS,
  listingOf,
  sellerWith,
  setUp,
  tearDown,
} from "./helpers.js";

const draftSeller = (extra = {}) =>
  sellerWith({
    status: "DRAFT",
    draftDueBy: new Date(Date.now() + 7 * DAY_MS),
    title: "Before",
    ...extra,
  });

describe("Seller page security (SEC)", () => {
  afterEach(tearDown);

  it.each([
    ["submit while SUBMITTED", "SUBMITTED", submit, { agree: "on" }, 409],
    ["live edit while DRAFT", "DRAFT", live, { askingPrice: "1" }, 409],
    [
      "upload while SUBMITTED",
      "SUBMITTED",
      uploadUrl,
      { contentType: "image/jpeg", byteSize: "9" },
      409,
    ],
    ["mark sold while DRAFT", "DRAFT", sold, { confirm: "yes" }, 409],
    [
      "revision while awaiting payment",
      "APPROVED_AWAITING_PAYMENT",
      revision,
      { title: "Changed title" },
      409,
    ],
  ])(
    "SEC: a stale action (%s) is refused",
    async (_, status, handler, form, code) => {
      await setUp();
      const seller = await sellerWith({ status, ...COMPLETE });

      const response = await call(handler, seller, form);

      expect(response.status).toBe(code);
      expect(await listingOf(seller)).toMatchObject({
        status,
        title: COMPLETE.title,
        askingPriceCents: COMPLETE.askingPriceCents,
      });
    },
  );

  it.each([
    ["missing", () => false],
    ["for another invitation", () => issueFormToken("other-invitation")],
    [
      "expired",
      (id) => issueFormToken(id, { now: new Date(Date.now() - 2 * DAY_MS) }),
    ],
  ])("SEC: a POST with a form token %s gets 403", async (_, token) => {
    await setUp();
    const seller = await draftSeller();

    const response = await call(
      draft,
      seller,
      { title: "Changed" },
      { csrf: token(seller.invitation.id) },
    );

    expect(response.status).toBe(403);
    expect((await listingOf(seller)).title).toBe("Before");
  });

  it("SEC: with codes required, a POST without this device's credential changes nothing", async () => {
    await setUp({ emailCodeRequired: true });
    const seller = await draftSeller();

    const page_ = await (
      await call(draft, seller, { title: "Changed" })
    ).text();
    const autosave = await call(
      draft,
      seller,
      { title: "Changed" },
      { headers: { "X-CC-Autosave": "1" } },
    );
    const allowed = await call(
      draft,
      seller,
      { title: "Changed" },
      {
        headers: {
          "X-CC-Autosave": "1",
          "X-CC-Device": issueDeviceCredential(seller.invitation.id),
        },
      },
    );

    expect(page_).toContain("Confirm it’s you");
    expect(autosave.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect((await listingOf(seller)).title).toBe("Changed");
  });

  it("SEC: seller text can't become HTML or Liquid; the page is private", async () => {
    await setUp();
    const seller = await draftSeller();

    const refused = await call(draft, seller, {
      title: "Lamp <script>x</script>",
    });
    await call(draft, seller, { title: "Lamp {{ shop.name }} {% x %}" });
    const response = await call(page, seller);
    const body = await response.text();

    expect(refused.status).toBe(422);
    expect(body).not.toMatch(/\{\{ shop|\{% x/);
    expect(body).toContain("Lamp &#123;&#123; shop.name &#125;&#125;");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each(["INVITED", "DRAFT", "LIVE", "PAUSED"])(
    "AC: the %s page's forms get this device's credential",
    async (status) => {
      await setUp({ emailCodeRequired: true });
      const seller = await sellerWith({
        status,
        ...COMPLETE,
        draftDueBy: new Date(Date.now() + DAY_MS),
      });

      const body = await (
        await call(page, seller, null, {
          headers: {
            "X-CC-Device": issueDeviceCredential(seller.invitation.id),
          },
        })
      ).text();

      expect(body).toContain("data-cc-device");
      expect(body).toContain('id="cc-data"');
      expect(body).toContain("localStorage.getItem(data.deviceKey)");
    },
  );

  it("SEC: the inline script can't close its tag or leave the raw block", () => {
    expect(pageScript()).not.toMatch(/<\/script|endraw/i);
  });

  it("SEC: the public name is the first name or 'Private seller', never the last name", async () => {
    await setUp();
    const seller = await draftSeller();

    await call(draft, seller, { sellerDisplay: "FIRST_NAME" });
    const first = (await listingOf(seller)).sellerDisplay;
    await call(draft, seller, { sellerDisplay: "PRIVATE" });

    expect(seller.invitation.sellerName).toBe("Sam Seller");
    expect(first).toBe("Sam");
    expect((await listingOf(seller)).sellerDisplay).toBe("Private seller");
  });

  it("SEC: too many actions for one link get 429", async () => {
    await setUp();
    const seller = await draftSeller();
    const save = () =>
      call(
        draft,
        seller,
        { title: "Saved title" },
        { headers: { "X-CC-Autosave": "1" } },
      );

    for (let i = 0; i < 60; i += 1) expect((await save()).status).toBe(200);
    expect((await save()).status).toBe(429);
  });
});
