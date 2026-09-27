// Standalone check: imports the REAL nextAvailableSlots from your own
// checkout (no reimplementation, no transcription risk) and prints what it
// returns for the exact call the test transcript made, so you can compare
// directly against what your live call actually said back.
//
// Run from mcp-server/:   npx tsx verify_slots.ts
// (npx will fetch tsx on first run if you don't have it installed already)

import { nextAvailableSlots } from "./src/lib/scheduling";

// Same department + roughly the same "now" as the test call's tool
// invocation (get_available_slots was called with no from_date, so it
// defaulted to `new Date().toISOString()` at that moment).
const fromDateIso = "2026-09-26T00:20:52.127771Z";

console.log("Your local UTC hours [7, 9, 11, 13] / count=5 default result:");
console.log(JSON.stringify(nextAvailableSlots("general_medicine", fromDateIso), null, 2));

console.log("\nWhat the live call actually returned (from the CSV transcript, for comparison):");
console.log(
  JSON.stringify(
    [
      { department: "general_medicine", slotTime: "2026-09-27T07:00:00.000Z" },
      { department: "general_medicine", slotTime: "2026-09-27T09:00:00.000Z" },
      { department: "general_medicine", slotTime: "2026-09-27T11:00:00.000Z" },
      { department: "general_medicine", slotTime: "2026-09-27T13:00:00.000Z" },
      { department: "general_medicine", slotTime: "2026-09-28T07:00:00.000Z" },
    ],
    null,
    2
  )
);

console.log(
  "\nIf the two blocks above differ (count and/or the hour values), your live " +
    "deployment is running different scheduling logic than this local file -- " +
    "redeploy with `telnyx-edge ship` from mcp-server/ to sync them. If they " +
    "match, the discrepancy is somewhere else and the code isn't the cause."
);
