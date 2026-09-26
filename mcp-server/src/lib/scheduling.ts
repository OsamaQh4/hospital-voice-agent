import type { Department } from "../types";

const SLOT_HOURS_UTC = [7, 9, 11, 13];
const SLOTS_TO_GENERATE = 5;

// Saudi Arabia's weekend is Friday/Saturday, so business days run Sun-Thu.
// getUTCDay(): 0=Sun,1=Mon,...,5=Fri,6=Sat.
function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 5 && day !== 6;
}

export interface AvailableSlot {
  department: Department;
  slotTime: string;
}

export function nextAvailableSlots(department: Department, fromDateIso: string): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const start = new Date(fromDateIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid fromDateIso: ${fromDateIso}`);
  }

  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  while (slots.length < SLOTS_TO_GENERATE) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isBusinessDay(cursor)) continue;
    for (const hour of SLOT_HOURS_UTC) {
      if (slots.length >= SLOTS_TO_GENERATE) break;
      const slotTime = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hour, 0, 0)
      );
      slots.push({ department, slotTime: slotTime.toISOString() });
    }
  }

  return slots;
}
