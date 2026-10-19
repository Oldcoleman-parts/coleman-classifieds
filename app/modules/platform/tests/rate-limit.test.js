import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rateLimit,
  resetRateLimits,
  rateLimitSize,
  clientIp,
} from "@/modules/platform/services/rate-limit.js";

const MAX_KEYS = 10_000;

function requestWithForwardedFor(value) {
  const headers = value === undefined ? {} : { "x-forwarded-for": value };
  return new Request("https://ocp-dev.myshopify.com/apps/classifieds/seller", {
    headers,
  });
}

beforeEach(() => {
  resetRateLimits();
});

describe("rateLimit", () => {
  it("AC: allows `limit` hits per window, blocks the next, and allows again after the window", () => {
    const options = { limit: 3, windowMs: 1000 };
    expect([
      rateLimit("win", { ...options, now: 0 }),
      rateLimit("win", { ...options, now: 1 }),
      rateLimit("win", { ...options, now: 2 }),
    ]).toEqual([true, true, true]);
    expect(rateLimit("win", { ...options, now: 3 })).toBe(false);
    expect(rateLimit("win", { ...options, now: 999 })).toBe(false);
    expect(rateLimit("win", { ...options, now: 1000 })).toBe(true);
  });

  it("AC: keys do not share counters", () => {
    const options = { limit: 1, windowMs: 1000, now: 0 };
    expect(rateLimit("key-a", options)).toBe(true);
    expect(rateLimit("key-a", options)).toBe(false);
    expect(rateLimit("key-b", options)).toBe(true);
  });

  it("AC: prunes expired keys once over the cap, keeps live ones", () => {
    const half = MAX_KEYS / 2;
    for (let i = 0; i < half; i += 1)
      rateLimit(`expired-${i}`, { limit: 1, windowMs: 1, now: 0 });
    for (let i = 0; i < half; i += 1)
      rateLimit(`live-${i}`, { limit: 1, windowMs: 1_000_000, now: 0 });
    expect(rateLimitSize()).toBe(MAX_KEYS);

    // The 10,001st key goes over the cap at a later time: the expired half is pruned.
    expect(rateLimit("new", { limit: 1, windowMs: 1000, now: 5 })).toBe(true);
    expect(rateLimitSize()).toBe(half + 1);

    // A live key kept its counter: its single hit is used up.
    expect(rateLimit("live-0", { limit: 1, windowMs: 1_000_000, now: 5 })).toBe(
      false,
    );
  });

  it("AC: prunes every expired key so memory stays small", () => {
    for (let i = 0; i < MAX_KEYS; i += 1)
      rateLimit(`old-${i}`, { limit: 1, windowMs: 1, now: 0 });
    expect(rateLimit("fresh", { limit: 1, windowMs: 1000, now: 5 })).toBe(true);
    expect(rateLimitSize()).toBe(1);
  });
});

describe("clientIp", () => {
  it.each([
    ["first entry of a forwarded list", "203.0.113.9, 10.0.0.1", "203.0.113.9"],
    ["IPv6 is lowercased", "2001:DB8::1", "2001:db8::1"],
    ["surrounding whitespace is trimmed", "   198.51.100.4  ", "198.51.100.4"],
  ])("AC: reads %s", (_name, header, expected) => {
    expect(clientIp(requestWithForwardedFor(header))).toBe(expected);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a non-IP word", "test"],
    ["an IPv4 with a port", "1.2.3.4:80"],
    ["a bracketed IPv6", "[::1]"],
    ["markup", "<script>"],
    ["a 10 kB header", "9".repeat(10_000)],
  ])('AC: %s gives "unknown"', (_name, header) => {
    expect(clientIp(requestWithForwardedFor(header))).toBe("unknown");
  });
});

describe("SEC: the rate-limit module never logs", () => {
  let spies;

  beforeEach(() => {
    spies = ["log", "info", "warn", "error", "debug"].map((method) =>
      vi.spyOn(console, method),
    );
  });

  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore());
  });

  it("SEC: calls with a personal key and a junk header print nothing", () => {
    for (let i = 0; i < 3; i += 1) {
      rateLimit("code-request:email:seller@example.com", {
        limit: 1,
        windowMs: 1000,
        now: i,
      });
    }
    clientIp(requestWithForwardedFor("<script>alert(1)</script>"));
    clientIp(requestWithForwardedFor("1.2.3.4:80"));
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
