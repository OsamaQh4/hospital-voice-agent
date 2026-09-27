import type { KvNamespace } from "@telnyx/edge-runtime";
import type { DepartmentInfo } from "../types";
import { log } from "./logger";

const DEPARTMENT_DIRECTORY_KEY = "department_directory";
const SAME_DAY_SLOTS_KEY = "feature_flag_same_day_slots_enabled";

/**
 * Static-ish reference data (department names, referral/walk-in policy) --
 * read on every call, changes rarely, wrong for at most one call if it does.
 * This is the textbook KV case: cheap, eventually-consistent, no per-patient
 * identity. Contrast with PatientActor, which holds one caller's booking
 * state and needs read-your-writes + serialized updates -- KV does not give
 * you that, which is why booking state is an Actor and this is KV, not the
 * other way around.
 */
const DEFAULT_DEPARTMENTS: DepartmentInfo[] = [
  {
    code: "general_medicine",
    displayNameEn: "General Medicine",
    displayNameAr: "الطب العام",
    referralRequired: false,
    walkInAccepted: true,
  },
  {
    code: "pediatrics",
    displayNameEn: "Pediatrics",
    displayNameAr: "طب الأطفال",
    referralRequired: false,
    walkInAccepted: true,
  },
  {
    code: "dental",
    displayNameEn: "Dental",
    displayNameAr: "طب الأسنان",
    referralRequired: false,
    walkInAccepted: false,
  },
];

/**
 * KV is meant to be a soft-fail read (see comment above) -- a platform-side
 * KV error should degrade to the built-in defaults, not crash the caller.
 * Seen in production 2026-09-26 17:42 UTC: an uncaught KV 500 here took
 * down the whole webhook-function process for ~2.5 minutes, which also
 * made the shared PatientActor (hosted by this same function) unreachable
 * and caused unrelated get_patient_status calls on mcp-server to hang 30s
 * and 502. Both functions now fail open instead.
 */
export async function getDepartmentDirectory(kv: KvNamespace): Promise<DepartmentInfo[]> {
  try {
    const cached = await kv.get<DepartmentInfo[]>(DEPARTMENT_DIRECTORY_KEY, { type: "json" });
    if (cached) return cached;
    // Seed on first read so a fresh deployment isn't a cache miss forever.
    await kv.put(DEPARTMENT_DIRECTORY_KEY, JSON.stringify(DEFAULT_DEPARTMENTS));
    return DEFAULT_DEPARTMENTS;
  } catch (error) {
    log("warn", "kv.get_department_directory.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_DEPARTMENTS;
  }
}

/**
 * Feature flag: whether the assistant is allowed to offer same-day slots.
 * A KV flag rather than a code constant so it can be flipped per-account
 * without a redeploy -- e.g. turned off during a staffing shortage.
 */
export async function getSameDaySlotsFlag(kv: KvNamespace, fallback = false): Promise<boolean> {
  try {
    const cached = await kv.get<boolean>(SAME_DAY_SLOTS_KEY, { type: "json" });
    if (cached === null) return fallback;
    return cached;
  } catch (error) {
    log("warn", "kv.get_same_day_slots_flag.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

/**
 * Manually set the same-day slots feature flag in KV.
 * Not called by any automated endpoint -- intended for one-off admin
 * scripts or manual toggling (e.g. via `telnyx-edge worker console`).
 */
export async function setSameDaySlotsFlag(kv: KvNamespace, value: boolean): Promise<void> {
  await kv.put(SAME_DAY_SLOTS_KEY, JSON.stringify(value));
}
