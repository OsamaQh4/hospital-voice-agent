import { env } from "@telnyx/edge-runtime";
import { TelnyxWebhookVerificationError } from "telnyx/lib/webhooks";
import { PatientActor } from "./actors/patientActor";
import { normalizeSaudiPhone } from "./lib/phone";
import { log, withTiming } from "./lib/logger";
import { getDepartmentDirectory, getSameDaySlotsFlag } from "./lib/kv";
import type { DynamicVariablesWebhookEvent, DynamicVariablesWebhookResponse } from "./types";

export { PatientActor };

export default {
  async fetch(request: Request): Promise<Response> {
    const correlationId = crypto.randomUUID();

    return withTiming(
      "dynamic_variables_webhook",
      { correlation_id: correlationId },
      async () => {
        const rawBody = await request.text();

        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
          headers[key] = value;
        });

        let publicKey: string;
        try {
          publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
        } catch (error) {
          log("error", "dynamic_variables_webhook.secret_missing", {
            correlation_id: correlationId,
            error: error instanceof Error ? error.message : String(error),
          });
          return emptyResponse();
        }

        let event: DynamicVariablesWebhookEvent;
        try {
          const unwrapped = await env.telnyx.webhooks.unwrap(rawBody, {
            headers,
            key: publicKey,
          });
          event = unwrapped as unknown as DynamicVariablesWebhookEvent;
        } catch (error) {
          if (error instanceof TelnyxWebhookVerificationError) {
            log("warn", "dynamic_variables_webhook.invalid_signature", {
              correlation_id: correlationId,
              reason: error.message,
            });
          } else {
            log("error", "dynamic_variables_webhook.verification_error", {
              correlation_id: correlationId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return emptyResponse();
        }

        const rawPhone = event.data?.payload?.telnyx_end_user_target;
        if (!rawPhone) {
          log("warn", "dynamic_variables_webhook.missing_phone", {
            correlation_id: correlationId,
          });
          return emptyResponse();
        }

        let phoneNumber: string;
        try {
          phoneNumber = normalizeSaudiPhone(rawPhone);
        } catch {
          log("warn", "dynamic_variables_webhook.phone_normalize_failed", {
            correlation_id: correlationId,
            raw_phone: rawPhone,
          });
          return emptyResponse();
        }

        const patient = env.PATIENT.idFromName(phoneNumber);

        const [profile, departments, sameDaySlotsEnabled] = await Promise.all([
          patient.recordCallStart(),
          getDepartmentDirectory(env.DEPARTMENT_KV),
          getSameDaySlotsFlag(env.DEPARTMENT_KV, false),
        ]);

        const hasExistingAppointment = profile.currentAppointment?.status === "booked";

        const response: DynamicVariablesWebhookResponse = {
          dynamic_variables: {
            patient_phone_number: profile.phoneNumber,
            patient_full_name: profile.fullName ?? "",
            is_repeat_caller: profile.callAttemptCount > 1,
            has_existing_appointment: hasExistingAppointment,
            existing_appointment_department: profile.currentAppointment?.department ?? "",
            existing_appointment_time: profile.currentAppointment?.slotTime ?? "",
            department_list: departments.map((d) => d.displayNameEn).join(", "),
            same_day_slots_enabled: sameDaySlotsEnabled,
            correlation_id: correlationId,
          },
        };

        log("info", "dynamic_variables_webhook.resolved", {
          correlation_id: correlationId,
          call_attempt_count: profile.callAttemptCount,
          is_repeat_caller: profile.callAttemptCount > 1,
          has_existing_appointment: hasExistingAppointment,
        });

        return jsonResponse(response);
      }
    );
  },
};

function emptyResponse(): Response {
  return jsonResponse({ dynamic_variables: {} });
}

function jsonResponse(body: DynamicVariablesWebhookResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
