import { env } from "@telnyx/edge-runtime";
import type { Department, PatientProfile } from "../../../webhook-function/src/types";
import { patientRecord } from "../../../webhook-function/src/lib/patientRecords";

/**
 * mcp-server's view of patient records. patientRecord() picks the backend
 * (PatientActorV2 via this function's Shared Actor reference, or the KV
 * stopgap) -- see webhook-function/src/lib/patientRecords.ts for the switch
 * and the history behind it.
 */
type Operation =
  | "getProfile"
  | "setFullName"
  | "bookAppointment"
  | "rescheduleAppointment"
  | "cancelAppointment"
  | "reset";

async function call<T>(phoneNumber: string, operation: Operation, args: unknown[] = []): Promise<T> {
  const record = patientRecord(env, phoneNumber) as unknown as Record<
    Operation,
    (...a: unknown[]) => Promise<unknown>
  >;
  return (await record[operation](...args)) as T;
}

export function patientActorClient() {
  return {
    getProfile: (phoneNumber: string) => call<PatientProfile>(phoneNumber, "getProfile"),
    setFullName: (phoneNumber: string, fullName: string) =>
      call<PatientProfile>(phoneNumber, "setFullName", [fullName]),
    bookAppointment: (phoneNumber: string, department: Department, slotTime: string) =>
      call<PatientProfile>(phoneNumber, "bookAppointment", [department, slotTime]),
    rescheduleAppointment: (phoneNumber: string, newSlotTime: string) =>
      call<PatientProfile>(phoneNumber, "rescheduleAppointment", [newSlotTime]),
    cancelAppointment: (phoneNumber: string) => call<PatientProfile>(phoneNumber, "cancelAppointment"),
    reset: (phoneNumber: string) => call<void>(phoneNumber, "reset"),
  };
}
