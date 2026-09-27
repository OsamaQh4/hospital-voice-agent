import { describe, expect, it } from "vitest";
import type { KvNamespace } from "@telnyx/edge-runtime";
import { PATIENT_BACKEND, kvKeyForPatient, patientRecord } from "./patientRecords";

function fakeKv() {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string, options?: { type?: string }) {
      const v = store.get(key);
      if (v === undefined) return null;
      return options?.type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KvNamespace;
  return { kv, store };
}

function bindings(kv: KvNamespace) {
  return {
    PATIENT: {
      idFromName: () => {
        throw new Error("actor path must not be used while PATIENT_BACKEND is kv");
      },
    },
    DEPARTMENT_KV: kv,
  };
}

const PHONE = "+966500000001";

describe("patientRecord (KV stopgap)", () => {
  it("is switched to kv", () => {
    expect(PATIENT_BACKEND).toBe("kv");
  });

  it("creates a fresh profile on first read and persists it", async () => {
    const { kv, store } = fakeKv();
    const profile = await patientRecord(bindings(kv), PHONE).getProfile();
    expect(profile).toMatchObject({ phoneNumber: PHONE, currentAppointment: null, callAttemptCount: 0 });
    expect(store.has(kvKeyForPatient(PHONE))).toBe(true);
  });

  it("recordCallStart increments across separate handles (state lives in KV)", async () => {
    const { kv } = fakeKv();
    await patientRecord(bindings(kv), PHONE).recordCallStart();
    const second = await patientRecord(bindings(kv), PHONE).recordCallStart();
    expect(second.callAttemptCount).toBe(2);
  });

  it("books, reschedules and cancels", async () => {
    const { kv } = fakeKv();
    const rec = patientRecord(bindings(kv), PHONE);
    await rec.setFullName("Test Patient");
    const booked = await rec.bookAppointment("dental", "2026-09-28T07:00:00.000Z");
    expect(booked.currentAppointment).toEqual({
      department: "dental",
      slotTime: "2026-09-28T07:00:00.000Z",
      status: "booked",
    });
    expect(booked.fullName).toBe("Test Patient");
    const moved = await rec.rescheduleAppointment("2026-09-29T09:00:00.000Z");
    expect(moved.currentAppointment?.slotTime).toBe("2026-09-29T09:00:00.000Z");
    const cancelled = await rec.cancelAppointment();
    expect(cancelled.currentAppointment?.status).toBe("cancelled");
  });

  it("keeps the actor's validation", async () => {
    const { kv } = fakeKv();
    const rec = patientRecord(bindings(kv), PHONE);
    await expect(rec.bookAppointment("cardiology" as never, "2026-09-28T07:00:00.000Z")).rejects.toThrow(
      "Invalid department"
    );
    await expect(rec.bookAppointment("dental", "not-a-date")).rejects.toThrow("Invalid slotTime");
    await expect(rec.rescheduleAppointment("2026-09-29T09:00:00.000Z")).rejects.toThrow(
      "No existing appointment"
    );
  });

  it("reset removes the record", async () => {
    const { kv, store } = fakeKv();
    const rec = patientRecord(bindings(kv), PHONE);
    await rec.recordCallStart();
    await rec.reset();
    expect(store.has(kvKeyForPatient(PHONE))).toBe(false);
    expect((await rec.getProfile()).callAttemptCount).toBe(0);
  });

  it("only ever produces keys Telnyx KV accepts, without collisions", () => {
    const allowed = /^[A-Za-z0-9\-_/=.]+$/;
    const ids = ["+966540088311", "+14155550123", "sip_lnxxs9gu_sip_telnyx_eu", "a=2b", "+a"];
    const keys = ids.map(kvKeyForPatient);
    for (const k of keys) expect(k).toMatch(allowed);
    expect(kvKeyForPatient("+966540088311")).toBe("patient/=2b966540088311");
    expect(new Set(keys).size).toBe(ids.length);
  });
});
