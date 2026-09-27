import type { KvNamespace } from "@telnyx/edge-runtime";
import type { AppointmentStatus, Department, PatientProfile } from "../types";

/**
 * Where patient records live. Both functions import this module, so this one
 * constant switches webhook-function and mcp-server together (redeploy both).
 *
 *   "actor" -- PatientActorV2, the intended design (see actors/patientActor.ts
 *              for why: serialized per-patient updates, read-your-writes).
 *   "kv"    -- STOPGAP. Since 2026-09-26 every StatefulActor invocation on
 *              this Telnyx account hangs ~30s then 502s -- every type, every
 *              function, including a brand-new type on brand-new functions
 *              (2026-09-27) -- so records live in KV until Telnyx fixes the
 *              account. Known trade-off: KV has no per-key serialization, so
 *              two writes to the same patient in the same instant can lose
 *              one, and a write may take a moment to be visible from another
 *              edge location. Acceptable for a demo line, not for real
 *              traffic. Flip back to "actor" once actor calls succeed again.
 *
 * The KV implementation deliberately mirrors PatientActorV2 method for
 * method (same validation, same return shapes) so callers don't care which
 * backend is active.
 */
export const PATIENT_BACKEND: "actor" | "kv" = "kv";

// Telnyx KV keys may only contain  a-z A-Z 0-9 - _ / = .  (a ":" or "+" is
// rejected with 400 "Invalid key format"). Patient ids are E.164 numbers
// ("+9665...") or SIP-derived keys, so every character outside
// [A-Za-z0-9_-.] -- including "=" itself, keeping this reversible and
// collision-free -- is written as "=" + two hex digits: "+966..." -> "=2b966...".
const KEY_PREFIX = "patient/";

export function kvKeyForPatient(phoneNumber: string): string {
  const safe = phoneNumber.replace(/[^A-Za-z0-9_.-]/g, (ch) => "=" + ch.charCodeAt(0).toString(16).padStart(2, "0"));
  return `${KEY_PREFIX}${safe}`;
}

export interface PatientRecord {
  getProfile(): Promise<PatientProfile>;
  recordCallStart(): Promise<PatientProfile>;
  setFullName(fullName: string): Promise<PatientProfile>;
  bookAppointment(department: Department, slotTime: string): Promise<PatientProfile>;
  rescheduleAppointment(newSlotTime: string): Promise<PatientProfile>;
  cancelAppointment(): Promise<PatientProfile>;
  updateAppointmentStatus(status: AppointmentStatus): Promise<PatientProfile>;
  reset(): Promise<void>;
}

const VALID_DEPARTMENTS: Department[] = ["general_medicine", "pediatrics", "dental"];
const VALID_STATUSES: AppointmentStatus[] = ["none", "booked", "completed", "cancelled"];

function assertValidSlotTime(slotTime: string): void {
  if (Number.isNaN(new Date(slotTime).getTime())) {
    throw new Error(`Invalid slotTime: ${slotTime}`);
  }
}

function kvPatientRecord(kv: KvNamespace, phoneNumber: string): PatientRecord {
  const key = kvKeyForPatient(phoneNumber);

  async function load(): Promise<PatientProfile> {
    const existing = await kv.get<PatientProfile>(key, { type: "json" });
    if (existing) return existing;
    const now = new Date().toISOString();
    const fresh: PatientProfile = {
      phoneNumber,
      currentAppointment: null,
      callAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await kv.put(key, JSON.stringify(fresh));
    return fresh;
  }

  async function save(profile: PatientProfile): Promise<PatientProfile> {
    profile.updatedAt = new Date().toISOString();
    await kv.put(key, JSON.stringify(profile));
    return profile;
  }

  return {
    getProfile: () => load(),
    async recordCallStart() {
      const profile = await load();
      profile.callAttemptCount += 1;
      return save(profile);
    },
    async setFullName(fullName) {
      const profile = await load();
      profile.fullName = fullName;
      return save(profile);
    },
    async bookAppointment(department, slotTime) {
      if (!VALID_DEPARTMENTS.includes(department)) {
        throw new Error(`Invalid department: ${department}`);
      }
      assertValidSlotTime(slotTime);
      const profile = await load();
      profile.currentAppointment = { department, slotTime, status: "booked" };
      return save(profile);
    },
    async rescheduleAppointment(newSlotTime) {
      assertValidSlotTime(newSlotTime);
      const profile = await load();
      if (profile.currentAppointment === null) {
        throw new Error("No existing appointment to reschedule");
      }
      profile.currentAppointment.slotTime = newSlotTime;
      profile.currentAppointment.status = "booked";
      return save(profile);
    },
    async cancelAppointment() {
      const profile = await load();
      if (profile.currentAppointment) {
        profile.currentAppointment.status = "cancelled";
      }
      return save(profile);
    },
    async updateAppointmentStatus(status) {
      if (!VALID_STATUSES.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }
      const profile = await load();
      if (profile.currentAppointment) {
        profile.currentAppointment.status = status;
      }
      return save(profile);
    },
    reset: () => kv.delete(key),
  };
}

/**
 * The bindings this needs, passed in rather than imported: mcp-server
 * imports this file across projects, and a runtime import of
 * @telnyx/edge-runtime from here would resolve to webhook-function's copy of
 * the package, not mcp-server's. Types-only imports keep it bundle-safe.
 */
export interface PatientRecordBindings {
  PATIENT: { idFromName(name: string): unknown };
  DEPARTMENT_KV: KvNamespace;
}

/** The one entry point both functions use to reach a patient's record. */
export function patientRecord(bindings: PatientRecordBindings, phoneNumber: string): PatientRecord {
  if (PATIENT_BACKEND === "actor") {
    // Cast: in mcp-server the generated binding is an untyped ActorNamespace
    // (the class ships from webhook-function).
    return bindings.PATIENT.idFromName(phoneNumber) as PatientRecord;
  }
  return kvPatientRecord(bindings.DEPARTMENT_KV, phoneNumber);
}
