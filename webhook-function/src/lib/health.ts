import type { KvNamespace } from "@telnyx/edge-runtime";
import { PATIENT_BACKEND } from "./patientRecords";

/**
 * GET /health -- a no-secret status check for a deployed function.
 *
 * Touches no patient data: the KV check round-trips a fixed synthetic key,
 * and the actor check calls a fixed synthetic instance id. So it's safe to
 * leave unauthenticated.
 *
 *   /health            -> KV round-trip only (fast)
 *   /health?actor=1    -> also calls PatientActorV2 on a probe instance,
 *                         capped at ACTOR_PROBE_TIMEOUT_MS so a broken actor
 *                         subsystem shows up as "timeout" instead of a 30s
 *                         hang. Use this to tell when actors work again and
 *                         PATIENT_BACKEND can go back to "actor".
 *
 * Always answers 200 with the details in the body; the `ok` field says
 * whether everything that was checked passed.
 */
const KV_PROBE_KEY = "health/probe"; // KV keys: a-z A-Z 0-9 - _ / = . only
const ACTOR_PROBE_ID = "health-probe";
const ACTOR_PROBE_TIMEOUT_MS = 8000;

export interface HealthBindings {
  PATIENT: { idFromName(name: string): unknown };
  DEPARTMENT_KV: KvNamespace;
}

interface CheckResult {
  ok: boolean;
  ms: number;
  error?: string;
}

async function timed(fn: () => Promise<void>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleHealth(request: Request, bindings: HealthBindings, functionName: string): Promise<Response> {
  const url = new URL(request.url);
  const checks: Record<string, CheckResult> = {};

  checks.kv = await timed(async () => {
    const value = new Date().toISOString();
    await bindings.DEPARTMENT_KV.put(KV_PROBE_KEY, value);
    const readBack = await bindings.DEPARTMENT_KV.get(KV_PROBE_KEY);
    if (readBack === null) throw new Error("wrote probe key but read back null");
  });

  if (url.searchParams.get("actor") === "1") {
    checks.actor = await timed(async () => {
      const probe = bindings.PATIENT.idFromName(ACTOR_PROBE_ID) as { getProfile(): Promise<unknown> };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ACTOR_PROBE_TIMEOUT_MS}ms`)), ACTOR_PROBE_TIMEOUT_MS);
      });
      try {
        await Promise.race([probe.getProfile(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  const body = {
    ok: Object.values(checks).every((c) => c.ok),
    function: functionName,
    patient_backend: PATIENT_BACKEND,
    checks,
    at: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
