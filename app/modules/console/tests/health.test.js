import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import {
  handleHealthAction,
  loadHealthScreen,
  setHealthProviders,
} from "@/modules/console/index.js";
import { setUp, tearDown, staffActor, STAFF, prisma } from "./helpers.js";

describe("F05-T2: System health", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    setHealthProviders(null);
    tearDown();
  });

  it("AC: with no providers, every section available is false and dbLive counts LIVE listings", async () => {
    await makeListing({ status: "LIVE" });
    await makeListing({ status: "LIVE" });
    await makeListing({ status: "SUBMITTED" });

    setHealthProviders(null);

    const screen = await loadHealthScreen();

    expect(screen.incidents.available).toBe(false);
    expect(screen.lastJobRun.available).toBe(false);
    expect(screen.email.available).toBe(false);
    expect(screen.liveCount.dbLive).toBe(2);
    expect(screen.liveCount.storefront).toBeNull();
    expect(screen.liveCount.matches).toBeNull();
  });

  it("AC: problems24h counts only EmailProblem audits within 24h of now", async () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const today = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    await prisma.auditEvent.createMany({
      data: [
        {
          listingId: null,
          actor: "SYSTEM",
          actorRef: "ses",
          action: "EmailProblem",
          details: { problem: "bounced" },
          at: yesterday,
        },
        {
          listingId: null,
          actor: "SYSTEM",
          actorRef: "ses",
          action: "EmailProblem",
          details: { problem: "failed" },
          at: today,
        },
        {
          listingId: null,
          actor: "SYSTEM",
          actorRef: "ses",
          action: "EmailProblem",
          details: { problem: "another" },
          at: today,
        },
      ],
    });

    setHealthProviders(null);

    const screen = await loadHealthScreen({ now });

    // Only the 2 from today should be counted
    expect(screen.email.problems24h).toBe(2);
  });

  it("AC: resolve incident is audited with staff email", async () => {
    setHealthProviders({
      incidents: {
        listOpen: async () => [
          {
            id: "inc-1",
            kind: "database_lag",
            message: "Lag detected",
            firstSeen: new Date(),
            lastSeen: new Date(),
          },
        ],
        resolve: async () => ({ changed: true, kind: "database_lag" }),
      },
    });

    const form = new FormData();
    form.set("intent", "resolve-incident");
    form.set("incidentId", "inc-1");
    const result = await handleHealthAction(form, staffActor);

    expect(result.ok).toBe(true);
    expect(result.already).toBe(false);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "IncidentResolved" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("STAFF");
    expect(audits[0].actorRef).toBe(STAFF.session.email);
    expect(audits[0].listingId).toBeNull();
  });

  it("AC: second resolve (changed false) writes no second audit", async () => {
    let resolveCount = 0;

    setHealthProviders({
      incidents: {
        listOpen: async () => [],
        resolve: async () => {
          resolveCount++;
          return { changed: resolveCount === 1, kind: "test_incident" };
        },
      },
    });

    // First resolve
    const form1 = new FormData();
    form1.set("intent", "resolve-incident");
    form1.set("incidentId", "inc-1");
    const result1 = await handleHealthAction(form1, staffActor);

    expect(result1.ok).toBe(true);
    expect(result1.already).toBe(false);
    expect(resolveCount).toBe(1);

    let audits = await prisma.auditEvent.findMany({
      where: { action: "IncidentResolved" },
    });
    expect(audits).toHaveLength(1);

    // Second resolve
    const form2 = new FormData();
    form2.set("intent", "resolve-incident");
    form2.set("incidentId", "inc-1");
    const result2 = await handleHealthAction(form2, staffActor);

    expect(result2.ok).toBe(true);
    expect(result2.already).toBe(true);
    expect(resolveCount).toBe(2);

    // No second audit
    audits = await prisma.auditEvent.findMany({
      where: { action: "IncidentResolved" },
    });
    expect(audits).toHaveLength(1);
  });

  it("SEC: the health page never shows secrets or connection strings", async () => {
    const before = {
      DATABASE_URL: process.env.DATABASE_URL,
      SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
    };
    process.env.SHOPIFY_API_SECRET = "shpss_test_secret_value";
    // Test that incident details (which might contain secrets) are not exposed
    setHealthProviders({
      incidents: {
        listOpen: async () => [
          {
            id: "inc-1",
            kind: "connection_issue",
            message: "Connection failed",
            firstSeen: new Date(),
            lastSeen: new Date(),
            details: {
              connectionString: "secret-connection-string",
              internalError: "Internal error details",
            },
          },
        ],
        resolve: async () => ({ changed: false }),
      },
      jobs: {
        getLastRun: async () => ({
          finishedAt: new Date(),
          ok: true,
          failedTasks: [],
        }),
      },
      email: {
        getHealth: async () => ({ ok: true }),
      },
      liveCount: {
        getStorefrontCount: async () => 5,
      },
    });

    const screen = await loadHealthScreen();
    const json = JSON.stringify(screen);
    const databaseUrl = process.env.DATABASE_URL;
    process.env.SHOPIFY_API_SECRET = before.SHOPIFY_API_SECRET;
    if (before.SHOPIFY_API_SECRET === undefined)
      delete process.env.SHOPIFY_API_SECRET;

    // Nothing from the configuration reaches the screen
    expect(json).not.toContain("shpss_test_secret_value");
    if (databaseUrl) expect(json).not.toContain(databaseUrl);
    expect(json).not.toMatch(/postgres(ql)?:\/\//);

    // Incident details should not appear in the output
    expect(json).not.toContain("secret-connection-string");
    expect(json).not.toContain("internalError");
    expect(json).not.toContain("Internal error details");

    // But the incident itself should exist with public fields
    expect(screen.incidents.available).toBe(true);
    expect(screen.incidents.rows).toHaveLength(1);
    expect(screen.incidents.rows[0].id).toBe("inc-1");
    expect(screen.incidents.rows[0].message).toBe("Connection failed");
  });

  it("AC: unknown intent returns not ok", async () => {
    setHealthProviders({
      incidents: {
        listOpen: async () => [],
        resolve: async () => ({ changed: false }),
      },
    });

    const form = new FormData();
    form.set("intent", "unknown-action");
    form.set("incidentId", "inc-1");
    const result = await handleHealthAction(form, staffActor);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("AC: no incidents provider returns 404", async () => {
    setHealthProviders(null);

    const form = new FormData();
    form.set("intent", "resolve-incident");
    form.set("incidentId", "inc-1");
    const result = await handleHealthAction(form, staffActor);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});
