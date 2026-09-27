import { describe, it, expect } from "vitest";
import { nextAvailableSlots, type AvailableSlot } from "./scheduling";

describe("nextAvailableSlots", () => {
  // 2026-09-26 is a Saturday (weekend in Saudi Arabia), 2026-09-27 is Sunday.
  const saturdayIso = "2026-09-26T00:20:52.127771Z";
  const sundayIso = "2026-09-27T00:20:52.127771Z";

  describe("default behavior (sameDayEnabled=false)", () => {
    it("skips Saturday and starts on Sunday", () => {
      const slots = nextAvailableSlots("general_medicine", saturdayIso, false);
      expect(slots.length).toBe(5);
      expect(slots[0].slotTime).toBe("2026-09-27T07:00:00.000Z");
      expect(slots[4].slotTime).toBe("2026-09-28T07:00:00.000Z");
    });

    it("skips the same day even if it is a business day", () => {
      const slots = nextAvailableSlots("general_medicine", sundayIso, false);
      expect(slots.length).toBe(5);
      // Should start on Monday, not Sunday
      expect(slots[0].slotTime).toBe("2026-09-28T07:00:00.000Z");
    });

    it("skips Friday and Saturday", () => {
      // 2026-10-01 is Thursday. Next should be Sunday 2026-10-04
      const thursdayIso = "2026-10-01T12:00:00.000Z";
      const slots = nextAvailableSlots("general_medicine", thursdayIso, false);
      expect(slots.length).toBe(5);
      expect(slots[0].slotTime).toBe("2026-10-04T07:00:00.000Z");
    });

    it("all slots belong to the requested department", () => {
      const slots = nextAvailableSlots("pediatrics", saturdayIso, false);
      expect(slots.every((s) => s.department === "pediatrics")).toBe(true);
    });
  });

  describe("same-day enabled", () => {
    it("includes the same day when it is a business day", () => {
      const slots = nextAvailableSlots("general_medicine", sundayIso, true);
      expect(slots.length).toBe(5);
      expect(slots[0].slotTime).toBe("2026-09-27T07:00:00.000Z");
    });

    it("includes same-day slots before next-day slots", () => {
      const slots = nextAvailableSlots("general_medicine", sundayIso, true);
      const hours = slots.map((s) => new Date(s.slotTime).getUTCHours());
      expect(hours.slice(0, 4)).toEqual([7, 9, 11, 13]);
      expect(hours[4]).toBe(7);
    });

    it("still skips weekend when starting from Friday with same-day enabled", () => {
      // 2026-10-02 is Friday (weekend). Even with sameDayEnabled, Friday is not a business day.
      const fridayIso = "2026-10-02T12:00:00.000Z";
      const slots = nextAvailableSlots("general_medicine", fridayIso, true);
      expect(slots.length).toBe(5);
      expect(slots[0].slotTime).toBe("2026-10-04T07:00:00.000Z");
    });

    it("produces consistent slot ordering regardless of time-of-day", () => {
      const morningIso = "2026-09-27T03:00:00.000Z";
      const eveningIso = "2026-09-27T20:00:00.000Z";
      const morningSlots = nextAvailableSlots("general_medicine", morningIso, true);
      const eveningSlots = nextAvailableSlots("general_medicine", eveningIso, true);
      expect(morningSlots.map((s) => s.slotTime)).toEqual(eveningSlots.map((s) => s.slotTime));
    });
  });

  describe("edge cases", () => {
    it("throws on invalid fromDateIso", () => {
      expect(() => nextAvailableSlots("general_medicine", "not-a-date")).toThrow(
        "Invalid fromDateIso: not-a-date"
      );
    });

    it("preserves default behavior when sameDayEnabled is omitted", () => {
      const slots = nextAvailableSlots("general_medicine", sundayIso);
      expect(slots[0].slotTime).toBe("2026-09-28T07:00:00.000Z");
    });
  });
});
