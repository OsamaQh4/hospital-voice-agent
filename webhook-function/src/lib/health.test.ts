import { describe, expect, it } from "vitest";
import type { KvNamespace } from "@telnyx/edge-runtime";
import { handleHealth } from "./health";

function kv(failing = false) {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      if (failing) throw new Error("KV 500");
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      if (failing) throw new Error("KV 500");
      store.set(key, value);
    },
  } as unknown as KvNamespace;
}

const workingActor = { idFromName: () => ({ getProfile: async () => ({}) }) };
const brokenActor = { idFromName: () => ({ getProfile: async () => Promise.reject(new Error("502: bad gateway")) }) };

async function run(url: string, bindings: Parameters<typeof handleHealth>[1]) {
  const res = await handleHealth(new Request(url), bindings, "test");
  return (await res.json()) as { ok: boolean; patient_backend: string; checks: Record<string, { ok: boolean; error?: string }> };
}

describe("/health", () => {
  it("checks KV only by default", async () => {
    const body = await run("https://x/health", { PATIENT: brokenActor, DEPARTMENT_KV: kv() });
    expect(body.ok).toBe(true);
    expect(body.checks.kv.ok).toBe(true);
    expect(body.checks.actor).toBeUndefined();
    expect(body.patient_backend).toBe("kv");
  });

  it("reports a KV failure", async () => {
    const body = await run("https://x/health", { PATIENT: workingActor, DEPARTMENT_KV: kv(true) });
    expect(body.ok).toBe(false);
    expect(body.checks.kv.error).toContain("KV 500");
  });

  it("probes the actor when asked", async () => {
    const good = await run("https://x/health?actor=1", { PATIENT: workingActor, DEPARTMENT_KV: kv() });
    expect(good.checks.actor.ok).toBe(true);
    const bad = await run("https://x/health?actor=1", { PATIENT: brokenActor, DEPARTMENT_KV: kv() });
    expect(bad.ok).toBe(false);
    expect(bad.checks.actor.error).toContain("502");
  });
});
