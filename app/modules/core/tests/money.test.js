import { describe, it, expect } from "vitest";
import * as core from "@/modules/core/index.js";
import {
  ValidationError,
  dollarsToCents,
  centsToDollars,
} from "@/modules/core";

// The error thrown for a bad amount, or null when the call succeeds.
const errorOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

describe("money parsers (F01-FIX-4)", () => {
  it.each([
    ["30", 3000],
    ["30.5", 3050],
    ["30.50", 3050],
    ["0.07", 7],
    [" 12.34 ", 1234],
    ["0.29", 29],
    ["19.99", 1999],
    ["9999999.99", 999999999],
  ])("AC: dollarsToCents parses %j as %i cents", (value, cents) => {
    expect(dollarsToCents(value, "offeredFee")).toBe(cents);
  });

  it.each([
    ["30.555"],
    ["1.005"],
    ["-5"],
    ["abc"],
    ["1e3"],
    ["$30"],
    ["30."],
    ["."],
    [""],
    [30],
    [null],
    [undefined],
  ])("AC: dollarsToCents rejects %j with the field error", (value) => {
    const error = errorOf(() => dollarsToCents(value, "offeredFee"));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("offeredFee is not a valid amount");
    expect(error.fields).toEqual({
      offeredFee: "must be an amount such as 30.00",
    });
  });

  it.each([
    [0, "0.00"],
    [7, "0.07"],
    [3050, "30.50"],
    [100000000, "1000000.00"],
    [-150, "-1.50"],
  ])("AC: centsToDollars formats %i as %j", (cents, text) => {
    expect(centsToDollars(cents)).toBe(text);
  });

  it("AC: centsToDollars refuses a fractional amount of cents", () => {
    const error = errorOf(() => centsToDollars(1.5));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("AC: dollarsToCents and centsToDollars are exported from core/index.js", () => {
    expect(typeof core.dollarsToCents).toBe("function");
    expect(typeof core.centsToDollars).toBe("function");
  });
});
