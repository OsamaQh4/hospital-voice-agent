import { env } from "@telnyx/edge-runtime";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { normalizeSaudiPhone } from "./lib/phone";
import { log, withTiming } from "./lib/logger";
import { nextAvailableSlots } from "./lib/scheduling";
import { sendSms } from "./lib/telnyxApi";
import { getDepartmentDirectory } from "./lib/kv";
import type { PatientProfile } from "./types";

// Shared Actor: PatientActor is owned and shipped by webhook-function.
// This project only needs its TYPE for `telnyx-edge types` codegen --
// re-exporting it here (type-only, erased at build time) is what lets
// `env.PATIENT` resolve to a fully typed ActorNamespace<PatientActor>
// without this project registering or shipping the class itself.
export type { PatientActor } from "../../webhook-function/src/actors/patientActor";

const DEPARTMENT_ENUM = z.enum(["general_medicine", "pediatrics", "dental"]);

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function buildServer(correlationId: string): McpServer {
  const server = new McpServer({ name: "hospital-appointments", version: "1.0.0" });

  server.registerTool(
    "get_patient_status",
    {
      title: "Get patient status",
      description:
        "Look up a patient by phone number: their name on file, call history, and current appointment (if any). Call this before booking to check whether the caller already has an appointment. Wait until the caller has given their complete phone number before calling this -- do not call it with partial or incomplete digits (e.g. while they're still reading the number out). A Saudi mobile number is 9-10 digits depending on format (05XXXXXXXX, 5XXXXXXXX, or +9665XXXXXXXX); if what you have doesn't match one of those shapes yet, ask for the rest of the number instead of calling this tool.",
      inputSchema: z.object({
        phone_number: z.string().describe("Caller's phone number, any common Saudi format"),
      }),
    },
    async ({ phone_number }) => {
      return withTiming("mcp.get_patient_status", { correlation_id: correlationId }, async () => {
        const phoneNumber = normalizeSaudiPhone(phone_number);
        const patient = env.PATIENT.idFromName(phoneNumber);
        const profile: PatientProfile = await patient.getProfile();
        return jsonResult(profile);
      });
    }
  );

  server.registerTool(
    "get_available_slots",
    {
      title: "Get available appointment slots",
      description:
        "List the next available appointment slots for a department. Department is a parameter, not a separate tool per department -- General Medicine, Pediatrics, and Dental all use this same lookup. After calling this, immediately read the caller 2-3 of the returned slot times (date and time) in your very next reply -- do not just acknowledge that slots were found without stating them, and do not wait for the caller to ask what the times are before saying them.",
      inputSchema: z.object({
        department: DEPARTMENT_ENUM,
        from_date: z
          .string()
          .optional()
          .describe("ISO 8601 date to search from; defaults to today"),
      }),
    },
    async ({ department, from_date }) => {
      return withTiming("mcp.get_available_slots", { correlation_id: correlationId, department }, async () => {
        const fromDateIso = from_date ?? new Date().toISOString();
        const slots = nextAvailableSlots(department, fromDateIso);
        return jsonResult({ department, slots });
      });
    }
  );

  server.registerTool(
    "book_appointment",
    {
      title: "Book an appointment",
      description:
        "Book a new appointment for a patient in a given department at a given slot time, replacing any prior appointment on file. Also records the patient's full name if not already known. Only call this after the caller has confirmed the department and slot out loud.",
      inputSchema: z.object({
        phone_number: z.string(),
        department: DEPARTMENT_ENUM,
        slot_time: z.string().describe("ISO 8601 timestamp of the chosen slot"),
        full_name: z.string().optional().describe("Patient's full name, if collected this call"),
      }),
    },
    async ({ phone_number, department, slot_time, full_name }) => {
      return withTiming(
        "mcp.book_appointment",
        { correlation_id: correlationId, department },
        async () => {
          const phoneNumber = normalizeSaudiPhone(phone_number);
          const patient = env.PATIENT.idFromName(phoneNumber);
          if (full_name) {
            await patient.setFullName(full_name);
          }
          const profile = await patient.bookAppointment(department, slot_time);
          return jsonResult(profile);
        }
      );
    }
  );

  server.registerTool(
    "reschedule_or_cancel_appointment",
    {
      title: "Reschedule or cancel an existing appointment",
      description:
        "Change or cancel a patient's current appointment. Use action='reschedule' with new_slot_time to move it, or action='cancel' to cancel it outright. Requires the patient already has an appointment on file -- check with get_patient_status first.",
      inputSchema: z.object({
        phone_number: z.string(),
        action: z.enum(["reschedule", "cancel"]),
        new_slot_time: z
          .string()
          .optional()
          .describe("Required when action='reschedule'; ISO 8601 timestamp of the new slot"),
      }),
    },
    async ({ phone_number, action, new_slot_time }) => {
      return withTiming(
        "mcp.reschedule_or_cancel_appointment",
        { correlation_id: correlationId, action },
        async () => {
          const phoneNumber = normalizeSaudiPhone(phone_number);
          const patient = env.PATIENT.idFromName(phoneNumber);

          if (action === "cancel") {
            const profile = await patient.cancelAppointment();
            return jsonResult(profile);
          }

          if (!new_slot_time) {
            return errorResult("new_slot_time is required when action is 'reschedule'");
          }
          const profile = await patient.rescheduleAppointment(new_slot_time);
          return jsonResult(profile);
        }
      );
    }
  );

  server.registerTool(
    "send_appointment_confirmation_sms",
    {
      title: "Send appointment confirmation SMS",
      description:
        "Send the patient a text message confirming their current booked appointment (department + time). Call this once, right after a successful booking or reschedule.",
      inputSchema: z.object({
        phone_number: z.string(),
      }),
    },
    async ({ phone_number }) => {
      return withTiming(
        "mcp.send_appointment_confirmation_sms",
        { correlation_id: correlationId },
        async () => {
          const phoneNumber = normalizeSaudiPhone(phone_number);
          const patient = env.PATIENT.idFromName(phoneNumber);
          const profile: PatientProfile = await patient.getProfile();

          if (!profile.currentAppointment || profile.currentAppointment.status !== "booked") {
            return errorResult("No booked appointment on file for this patient");
          }

          try {
            const [fromNumber, departments] = await Promise.all([
              env.SECRETS.get("HOSPITAL_SMS_FROM_NUMBER"),
              getDepartmentDirectory(env.DEPARTMENT_KV),
            ]);
            const departmentName =
              departments.find((d) => d.code === profile.currentAppointment!.department)?.displayNameEn ??
              profile.currentAppointment.department;

            const text = `Your appointment is confirmed: ${departmentName} on ${profile.currentAppointment.slotTime}. Reply to this number if you need to reschedule.`;

            const messageId = await sendSms(env.telnyx, { to: phoneNumber, from: fromNumber, text });
            log("info", "mcp.sms_sent", { correlation_id: correlationId, message_id: messageId });
            return jsonResult({ sent: true, message_id: messageId });
          } catch (error) {
            log("error", "mcp.sms_send_failed", {
              correlation_id: correlationId,
              error: error instanceof Error ? error.message : String(error),
            });
            return errorResult("Failed to send confirmation SMS");
          }
        }
      );
    }
  );

  server.registerTool(
    "reset_patient_state",
    {
      title: "Reset patient state (demo/admin only)",
      description:
        "Wipes a patient's stored profile and appointment. Not part of the caller-facing conversation flow -- scoped to this node's tool list only for a demo/admin path, so it can never be reached from ordinary caller intent.",
      inputSchema: z.object({
        phone_number: z.string(),
      }),
    },
    async ({ phone_number }) => {
      return withTiming("mcp.reset_patient_state", { correlation_id: correlationId }, async () => {
        const phoneNumber = normalizeSaudiPhone(phone_number);
        const patient = env.PATIENT.idFromName(phoneNumber);
        await patient.reset();
        return jsonResult({ reset: true });
      });
    }
  );

  return server;
}

const handler = createMcpHandler((ctx) => {
  const correlationId = ctx.requestInfo?.headers.get("x-correlation-id") ?? crypto.randomUUID();
  return buildServer(correlationId);
});

export default {
  fetch: (request: Request) => handler.fetch(request),
};