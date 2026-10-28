import { describe, it, expect } from "vitest";
import {
  redactRequestPath,
  scrubUrl,
  formatRequestLine,
} from "@/modules/platform/server/request-log.js";

describe("request-log: redactRequestPath", () => {
  it.each([
    // Bare seller token
    [
      "/proxy/seller/abcdefghijklmnopqrstuvwxyz123456",
      "/proxy/seller/[redacted]",
    ],
    // Token plus action
    [
      "/proxy/seller/abcdefghijklmnopqrstuvwxyz123456/draft",
      "/proxy/seller/[redacted]/draft",
    ],
    // Seller token with .data suffix (token gets redacted, .data stays)
    [
      "/proxy/seller/abcdefghijklmnopqrstuvwxyz123456.data",
      "/proxy/seller/[redacted]",
    ],
    // Seller token with draft.data (draft is safe word, .data stays)
    [
      "/proxy/seller/abcdefghijklmnopqrstuvwxyz123456/draft.data",
      "/proxy/seller/[redacted]/draft.data",
    ],
    // Apps classifieds seller token
    [
      "/apps/classifieds/seller/abcdefghijklmnopqrstuvwxyz123456",
      "/apps/classifieds/seller/[redacted]",
    ],
    // Percent-encoded token
    [
      "/proxy/seller/%61%62%63%64%65%66%67%68%69%6a%6b%6c",
      "/proxy/seller/[redacted]",
    ],
    // Unknown proxy segment (both parts not in PROXY_WORDS get redacted)
    ["/proxy/unknown/segment", "/proxy/[redacted]/[redacted]"],
    // My-link kept as is
    ["/proxy/my-link", "/proxy/my-link"],
    // App listings with 25-char cuid kept
    [
      "/app/listings/clxyz123456789012345678",
      "/app/listings/clxyz123456789012345678",
    ],
    // 43-char segment outside proxy redacted
    [
      "/app/files/abcdefghijklmnopqrstuvwxyz1234567890abc",
      "/app/files/[redacted]",
    ],
    // Absolute URL with token
    [
      "https://host/proxy/seller/abcdefghijklmnopqrstuvwxyz123456?x=1",
      "/proxy/seller/[redacted]",
    ],
    // Query with shop, signature, email dropped
    [
      "/proxy/seller/token123456789012345678?shop=test.myshopify.com&signature=abc123def456&email=someone@example.com",
      "/proxy/seller/[redacted]",
    ],
  ])("AC1: redactRequestPath(%s) = %s", (input, expected) => {
    expect(redactRequestPath(input)).toBe(expected);
  });

  it("AC1: path capped at 200 chars", () => {
    const longPath = "/proxy/seller/" + "a".repeat(200);
    const result = redactRequestPath(longPath);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe("request-log: scrubUrl", () => {
  it("AC2: scrubUrl removes token and query values from text", () => {
    const url = "/proxy/seller/mysecrettoken123456?email=test@example.com";
    const text =
      "Failed at /proxy/seller/mysecrettoken123456 with email mysecrettoken123456 and test@example.com";
    const result = scrubUrl(text, url);

    expect(result).not.toContain("mysecrettoken123456");
    expect(result).not.toContain("test@example.com");
    expect(result).toContain("[redacted]");
  });

  it("AC2: scrubUrl handles percent-encoded values", () => {
    const encodedToken = "a%20b%20c%20d";
    const url = `/proxy/seller/${encodedToken}`;
    const text = `Error: visited /proxy/seller/${encodedToken}`;
    const result = scrubUrl(text, url);

    expect(result).not.toContain(encodedToken);
    expect(result).not.toContain("a b c d");
  });

  it("AC2: scrubUrl removes long query values", () => {
    const url = "/path?signature=abc123def456longvalue&x=y";
    const text = "Error with signature abc123def456longvalue";
    const result = scrubUrl(text, url);

    expect(result).not.toContain("abc123def456longvalue");
    expect(result).toContain("[redacted]");
  });
});

describe("request-log: formatRequestLine", () => {
  it("AC1: formatRequestLine returns correct format", () => {
    const result = formatRequestLine({
      method: "GET",
      url: "/proxy/seller/token123/draft?email=test@test.com",
      status: 200,
      ms: 42,
    });

    expect(result).toMatch(
      /^GET \/proxy\/seller\/\[redacted\]\/draft 200 42ms$/,
    );
    expect(result).not.toContain("token123");
    expect(result).not.toContain("?");
    expect(result).not.toContain("test@test.com");
  });

  it("AC1: formatRequestLine with POST request", () => {
    const result = formatRequestLine({
      method: "POST",
      url: "/apps/classifieds/seller/abc/submit",
      status: 303,
      ms: 125,
    });

    expect(result).toMatch(
      /^POST \/apps\/classifieds\/seller\/\[redacted\]\/submit 303 125ms$/,
    );
  });
});
