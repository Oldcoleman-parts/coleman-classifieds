import { describe, it, expect } from "vitest";
import {
  requireString,
  optionalString,
  requireEmail,
  requireInt,
  requireCents,
  requireEnum,
  requireId,
  readForm,
  ValidationError,
} from "@/modules/core";

const checkThrows = (fn, expected) => {
  try {
    fn();
    return false;
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    return Object.values(e.fields).some((f) => f.includes(expected));
  }
};

describe("validators", () => {
  it.each([
    ["hello", "hello"],
    ["  hello  ", "hello"],
    ["a".repeat(5000), "a".repeat(5000)],
  ])("AC: requireString accepts valid strings", (value, expected) => {
    expect(requireString(value, "name")).toBe(expected);
  });

  it.each([
    [null, "is required"],
    [undefined, "is required"],
    [123, "is required"],
    ["  ", "is required"],
    ["x".repeat(5001), "at most"],
  ])("AC: requireString rejects invalid", (value, msg) => {
    expect(checkThrows(() => requireString(value, "name"), msg)).toBe(true);
  });

  it("AC: requireString respects min/max", () => {
    expect(requireString("abc", "x", { min: 3 })).toBe("abc");
    expect(() => requireString("ab", "x", { min: 3 })).toThrow();
  });

  it.each([
    ["hello", "hello"],
    ["  hello  ", "hello"],
    [null, null],
    [undefined, null],
    ["  ", null],
  ])("AC: optionalString accepts strings and nulls", (value, expected) => {
    expect(optionalString(value, "desc")).toBe(expected);
  });

  it.each([
    [123, "must be text"],
    ["x".repeat(5001), "at most"],
  ])("AC: optionalString rejects invalid", (value, msg) => {
    expect(checkThrows(() => optionalString(value, "desc"), msg)).toBe(true);
  });

  it.each([
    ["user@example.com", "user@example.com"],
    ["  User@EXAMPLE.COM  ", "user@example.com"],
  ])("AC: requireEmail accepts valid (lowercased)", (value, expected) => {
    expect(requireEmail(value, "email")).toBe(expected);
  });

  it.each([
    ["invalid", "valid email"],
    ["user@", "valid email"],
    [null, "required"],
  ])("AC: requireEmail rejects invalid", (value, msg) => {
    expect(checkThrows(() => requireEmail(value, "email"), msg)).toBe(true);
  });

  it.each([
    [42, 42],
    ["42", 42],
    [-1, -1],
    [0, 0],
  ])("AC: requireInt accepts integers", (value, expected) => {
    expect(requireInt(value, "count")).toBe(expected);
  });

  it.each([
    [3.14, "whole number"],
    ["abc", "whole number"],
    [null, "whole number"],
  ])("AC: requireInt rejects non-integers", (value, msg) => {
    expect(checkThrows(() => requireInt(value, "count"), msg)).toBe(true);
  });

  it("AC: requireInt respects bounds", () => {
    expect(requireInt(5, "x", { min: 0, max: 10 })).toBe(5);
    expect(() => requireInt(-1, "x", { min: 0 })).toThrow();
  });

  it.each([
    [0, 0],
    [3000, 3000],
    ["5000", 5000],
  ])("AC: requireCents accepts valid", (value, expected) => {
    expect(requireCents(value, "price")).toBe(expected);
  });

  it.each([
    [-1, "at least 0"],
    [100_000_001, "at most"],
  ])("AC: requireCents enforces range", (value, msg) => {
    expect(checkThrows(() => requireCents(value, "price"), msg)).toBe(true);
  });

  it("AC: requireEnum validates enum values", () => {
    const allowed = ["DRAFT", "LIVE"];
    expect(requireEnum("DRAFT", allowed, "status")).toBe("DRAFT");
    expect(
      checkThrows(
        () => requireEnum("INVALID", allowed, "status"),
        "must be one of",
      ),
    ).toBe(true);
  });

  it("AC: requireId validates id format", () => {
    expect(requireId("abc123", "id")).toBe("abc123");
    expect(checkThrows(() => requireId("x@y", "id"), "valid id")).toBe(true);
  });

  it("AC: readForm collects multiple field problems", () => {
    const form = new FormData();
    form.append("name", "");
    form.append("email", "bad");
    const shape = {
      name: (v, f) => requireString(v, f),
      email: (v, f) => requireEmail(v, f),
    };
    expect(() => readForm(form, shape)).toThrow(ValidationError);
    try {
      readForm(form, shape);
    } catch (e) {
      expect(e.fields.name).toBeDefined();
      expect(e.fields.email).toBeDefined();
    }
  });

  it("AC: readForm returns cleaned values", () => {
    const form = new FormData();
    form.append("name", "  Alice  ");
    form.append("email", "  Alice@EXAMPLE.COM  ");
    const shape = {
      name: (v, f) => requireString(v, f),
      email: (v, f) => requireEmail(v, f),
    };
    const result = readForm(form, shape);
    expect(result.name).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
  });
});
