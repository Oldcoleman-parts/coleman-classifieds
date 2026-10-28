import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { loader as historyLoader } from "@/routes/app.history._index.jsx";
import { loader as exportLoader } from "@/routes/app.history.export.jsx";
import { action as exportCsvAction } from "@/routes/app.history.export-csv.jsx";
import { setUp, tearDown, STAFF, prisma } from "./helpers.js";

// What `authenticate.admin` does for this test: a mode that throws the login redirect, or
// resolves with a staff session that carries `redirect`.
const auth = vi.hoisted(() => ({ session: null }));

vi.mock("@/shopify.server", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    authenticate: {
      ...original.authenticate,
      admin: async () => {
        if (!auth.session) {
          throw new Response(null, {
            status: 302,
            headers: { Location: "/auth/login" },
          });
        }
        return auth.session;
      },
    },
  };
});

const SHOP_QUERY = "&shop=ocp-dev.myshopify.com&host=dGVzdA";

function sessionWithRedirect() {
  return {
    session: STAFF.session,
    redirect: (url) =>
      new Response(null, { status: 302, headers: { Location: url } }),
  };
}

/** The thrown value of a promise that must reject. */
async function rejectionOf(promise) {
  try {
    await promise;
  } catch (thrown) {
    return thrown;
  }
  throw new Error("expected the promise to reject");
}

describe("F05-T3: History routes", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
    auth.session = null;
  });

  afterEach(() => {
    tearDown();
  });

  it("AC: the history page needs a Shopify admin session", async () => {
    const request = new Request("https://app.example.test/app/history");
    const thrown = await rejectionOf(historyLoader({ request }));
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(302);
  });

  it("AC: the export without a session is refused and writes no audit entry", async () => {
    const listing = await makeListing();
    const formData = new FormData();
    formData.set("listingId", listing.id);
    const request = new Request(
      "https://app.example.test/app/history/export-csv",
      {
        method: "POST",
        body: formData,
      },
    );

    const thrown = await rejectionOf(exportCsvAction({ request }));
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(302);
    const audits = await prisma.auditEvent.count({
      where: { action: "HistoryExported" },
    });
    expect(audits).toBe(0);
  });

  it("AC: an export from a session with no online user answers 403 and writes no audit entry", async () => {
    auth.session = {
      session: {
        ...STAFF.session,
        isOnline: false,
        onlineAccessInfo: undefined,
      },
      redirect: sessionWithRedirect().redirect,
    };
    const listing = await makeListing();
    const formData = new FormData();
    formData.set("listingId", listing.id);
    const request = new Request(
      "https://app.example.test/app/history/export-csv",
      { method: "POST", body: formData },
    );

    const response = await exportCsvAction({ request });
    expect(response.status).toBe(403);
    const audits = await prisma.auditEvent.count({
      where: { action: "HistoryExported" },
    });
    expect(audits).toBe(0);
  });

  it("AC: the old export link redirects to the history page and keeps listingId", async () => {
    auth.session = sessionWithRedirect();
    const listing = await makeListing();
    const search = `?listingId=${listing.id}${SHOP_QUERY}`;
    const request = new Request(
      `https://app.example.test/app/history/export${search}`,
    );

    const response = await exportLoader({ request });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/app/history${search}`);
  });
});
