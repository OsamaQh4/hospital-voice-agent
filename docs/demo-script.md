# Demo script

Phone: **+1 512 316 0965**. Call from your own mobile, and give that same
mobile number when asked. The webhook identifies callers by caller ID and
the tools by the number spoken, so matching them makes the second call
personalized.

## Before the demo (10 minutes ahead)

```
telnyx-edge bindings validate                # renew with: telnyx-edge bindings update
curl -s https://hospital-webhook-v2-d8dc2b29-b.telnyxcompute.com/health; echo
curl -s https://hospital-mcp-v2-da6c4e1c-8.telnyxcompute.com/health; echo
```

Open on screen:
- Terminal 1: `telnyx-edge logs hospital-webhook-v2 --since 2m` (re-run as needed)
- Terminal 2: `telnyx-edge logs hospital-mcp-v2 --since 2m`
- Portal: the assistant's workflow canvas
- Phone ready to show the SMS

## Live demo (8–10 min)

**1. Booking: workflow, MCP tools, SMS (3 min)**
- Call. The Disclosure speak node plays verbatim.
- "I'd like to book an appointment." Identify Intent routes to Book
  Appointment through an LLM condition.
- Dental, give a name, pick a slot. Tool calls: `get_available_slots`,
  then `book_appointment`, then `send_appointment_confirmation_sms`.
- Show the SMS on the phone. Show `mcp.book_appointment.success` and
  `duration_ms` in Terminal 2.

**2. Returning caller: dynamic variables and routing (2–3 min)**
- Call again from the same phone. Before the call connects, the webhook
  returns `patient_full_name`, `has_existing_appointment` and the existing
  appointment.
- Show `dynamic_variables_webhook.resolved` in Terminal 1, with
  `call_attempt_count` and `is_repeat_caller`.
- Ask about your appointment. The variable-comparison edge
  (`has_existing_appointment == true`) routes to Existing Appointment
  Check, which already knows the booking. Reschedule it, or cancel it.

**3. Fallback and safety paths (1–2 min)**
- A general question ("Which departments do you have?") goes to Admin FAQ,
  which answers from `department_list`.
- An emergency phrase ("I have severe chest pain") goes to Emergency
  Escalation (the 997 message), then the call hangs up.

**4. Edge Compute (2 min)**
```
telnyx-edge list
telnyx-edge inspect hospital-webhook-v2          # KV, secrets, actor (owner)
telnyx-edge actors inspect PatientActorV2        # owner + reference functions
telnyx-edge storage kv key list 176fe6e5-d42d-47ec-8ae1-47f93478e0d4   # patient/… keys from the calls
curl -s "https://hospital-webhook-v2-d8dc2b29-b.telnyxcompute.com/health?actor=1"; echo
```
The last command shows KV healthy and the actor timing out. That leads
into the incident.

Don't use the time read back on the call as proof of anything: time
display is a known issue.

## Walkthrough and decisions (7–10 min)

1. **Use case.** A hospital line: high call volume, repetitive scheduling,
   three departments, and a clear safety boundary (no medical advice, 997).
2. **Workflow.** Eight nodes. Speak nodes wherever the wording must be
   exact (disclosure, emergency, closing). LLM conditions for intent;
   a variable comparison for returning callers, since that's a fact, not
   a judgement. Node instructions *append* to the base prompt, which holds
   the voice style (short, spoken), so each node only adds its task.
   MCP tools are assistant-wide, so routing is what keeps each step
   focused. Identify Intent and Admin FAQ have no tools of their own.
3. **MCP server.** Six tools on one server. The department is a
   parameter, not a separate tool set. Phone numbers are validated in the
   tool, and the description tells the model to wait for the full number.
4. **Dynamic variables.** Call count, name and existing appointment:
   personalization and routing. The webhook fails open, so a slow or
   broken backend never blocks the call.
5. **State choices.** The README table: actor for per-patient
   read-modify-write across two functions, KV for directory and flag,
   plain code for slots.
6. **OpenCode and Telnyx Inference.** The plugin failed to load under
   opencode v2.0.16. Show `opencode.json`: Telnyx Inference configured as
   an OpenAI-compatible provider, running Kimi K2.6. Later debugging was
   done with Claude.
7. **Hardest bug: the actor outage.** Symptom: 30 s, then a 502. Isolated
   one variable at a time: owner vs reference, method, fresh instance,
   fresh function and type, original code. The owner's logs showed the
   call leaving for the actor router and never arriving. Workaround: KV
   behind a switch, `/health` to see when it recovers. Possible trigger:
   actor ids containing `.`, now sanitized. Next step: a Telnyx ticket.
8. **Second bug: routing.** "Check my appointment" stuck in Identify
   Intent. Found in transcript metadata (`flow_node_id`). Fixed with an
   LLM edge, verified by exporting the live flow via the API.

## Likely questions

- **Why not KV from the start?** Two functions write the same patient
  record within one call. KV has no per-key serialization, so
  read-modify-write could lose an update. That's the trade-off the
  fallback accepts, temporarily.
- **What would you improve?** Time display (tools return a Riyadh-time
  label), passing the correlation ID through to MCP calls, per-node
  tool scoping if the platform supports it for MCP, and Arabic via an
  IVR language choice.
- **How would you know it broke in production?** `/health` polling,
  `.failure` events and `duration_ms` in the logs, and `tool_timeout` in
  transcripts. See "Knowing it's broken within a minute" in the README.
