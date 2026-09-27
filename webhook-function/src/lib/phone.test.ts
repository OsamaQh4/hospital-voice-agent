import { describe, it, expect } from "vitest";
import { normalizeSaudiPhone } from "./phone";

describe("normalizeSaudiPhone", () => {
  describe("Saudi mobile numbers", () => {
    it("normalizes +9665XXXXXXXX", () => {
      expect(normalizeSaudiPhone("+966501234567")).toBe("+966501234567");
    });

    it("normalizes 9665XXXXXXXX (no plus)", () => {
      expect(normalizeSaudiPhone("966501234567")).toBe("+966501234567");
    });

    it("normalizes 05XXXXXXXX (national with trunk 0)", () => {
      expect(normalizeSaudiPhone("0501234567")).toBe("+966501234567");
    });

    it("normalizes 5XXXXXXXX (national no trunk)", () => {
      expect(normalizeSaudiPhone("501234567")).toBe("+966501234567");
    });
  });

  describe("US/NANP numbers", () => {
    it("normalizes +1XXXXXXXXXX", () => {
      expect(normalizeSaudiPhone("+12125551234")).toBe("+12125551234");
    });

    it("normalizes 1XXXXXXXXXX (country code no plus)", () => {
      expect(normalizeSaudiPhone("12125551234")).toBe("+12125551234");
    });

    it("normalizes XXXXXXXXXX (10-digit local)", () => {
      expect(normalizeSaudiPhone("2125551234")).toBe("+12125551234");
    });
  });

  describe("SIP test identities", () => {
    it("maps SIP URIs to a punctuation-free key", () => {
      expect(normalizeSaudiPhone("lnxxs9gu@sip.telnyx.eu")).toBe("sip_lnxxs9gu_sip_telnyx_eu");
    });

    it("is case-insensitive for SIP URIs", () => {
      expect(normalizeSaudiPhone("LnXxS9gU@SIP.telnyx.EU")).toBe("sip_lnxxs9gu_sip_telnyx_eu");
    });

    it("never produces '.' or '@' in a key", () => {
      for (const raw of ["a.b@sip.telnyx.eu", "x@y.z", "0540088311", "+14155550123"]) {
        expect(normalizeSaudiPhone(raw)).not.toMatch(/[.@]/);
      }
    });
  });

  describe("E.164 pass-through", () => {
    it("passes through already-E.164 numbers from other regions", () => {
      expect(normalizeSaudiPhone("+441234567890")).toBe("+441234567890");
    });
  });

  describe("invalid inputs", () => {
    it("throws for completely invalid strings", () => {
      expect(() => normalizeSaudiPhone("not-a-phone")).toThrow('Invalid phone number: "not-a-phone"');
    });

    it("throws for too-short digit strings", () => {
      expect(() => normalizeSaudiPhone("12345")).toThrow('Invalid phone number: "12345"');
    });
  });

  describe("whitespace trimming", () => {
    it("trims surrounding whitespace", () => {
      expect(normalizeSaudiPhone("  +966501234567  ")).toBe("+966501234567");
    });
  });
});
