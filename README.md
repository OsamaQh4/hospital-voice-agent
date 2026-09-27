# Hospital Appointments Voice Assistant

A Telnyx AI Assistant that answers a hospital's phone line and handles
administrative scheduling for three departments: General Medicine,
Pediatrics, and Dental. Callers can check, book, reschedule, or cancel an
appointment, get an SMS confirmation, and ask general questions about the
departments. It gives no medical advice, and it directs emergencies to 997.

| | |
|---|---|
| Phone number | **+1 512 316 0965** |
| Dynamic-variables webhook | https://hospital-webhook-v2-d8dc2b29-b.telnyxcompute.com |
| MCP server | https://hospital-mcp-v2-da6c4e1c-8.telnyxcompute.com |
| Health checks | `/health` on either URL (add `?actor=1` to include the actor) |

Try it: call the number and ask to book an appointment, then call again and
ask to check it. Demo walkthrough: [`docs/demo-script.md`](docs/demo-script.md).

Built for the Telnyx Forward Deployed Engineer take-home.

## How it works

```
  Caller ──► Telnyx AI Assistant  (Kimi K2.6, conversation flow, Telnyx voice)
                 │                               │
     at call start: dynamic variables   during the call: MCP tools
                 │                               │
                 ▼                               ▼
      hospital-webhook-v2              hospital-mcp-v2
      (Edge Function)                  (Edge Function, MCP over HTTP)
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                     Patient records, per phone number
                     PatientActorV2 (Stateful Actor)
                     or KV, chosen by PATIENT_BACKEND
                                 │
                 DEPARTMENT_KV: department directory, same-day-slots flag
                 Telnyx Messaging: confirmation SMS
```

- **`webhook-function`** (`hospital-webhook-v2`) runs once at call start.
  It verifies the request's Ed25519 signature (`telnyx.webhooks.unwrap`),
  records the call against the caller's number, and returns dynamic
  variables to the assistant: `patient_phone_number`, `patient_full_name`, `is_repeat_caller`,
  `has_existing_appointment`, `existing_appointment_department`,
  `existing_appointment_time`, `department_list`, `same_day_slots_enabled`,
  and `correlation_id`. It also ships the `PatientActorV2` class.
- **`mcp-server`** (`hospital-mcp-v2`) exposes the tools the assistant calls
  during the conversation. It references the same actor type without
  shipping the class (a Shared Actor).
- Both functions read and write patient records through one module,
  `webhook-function/src/lib/patientRecords.ts`.

## Patient records: actor, with a KV fallback

Patient records live in a **Stateful Actor**, one instance per phone
number. Two functions write the same record within one call: the webhook
at call start, then the tools mid-call. An actor processes one request per
instance at a time, so "read the appointment, then change it" can never
lose an update. The phone number is the instance id.

**Currently running on KV.** Since 2026-09-26, every actor call on this
Telnyx account fails (see "Incident" below), so records are stored in KV.
One constant switches both functions:

```ts
// webhook-function/src/lib/patientRecords.ts
export const PATIENT_BACKEND: "actor" | "kv" = "kv";
```

The KV version mirrors the actor method for method, with the same
validation and the same return shapes, under keys `patient/<id>`. Telnyx KV
keys allow only `a-z A-Z 0-9 - _ / = .`, so other characters are encoded as
`=` plus two hex digits: `+966…` becomes `=2b966…`. KV does not serialize
writes per key, so two writes to the same patient in the same instant can
lose one. That's acceptable for a demo line, but not for production
traffic. Once `/health?actor=1` reports the actor healthy, set the switch
back to `"actor"` and redeploy both functions.

| State | Where | Why |
|---|---|---|
| Patient name, current appointment, call count | Actor (KV while the actor is unavailable) | Written by two functions in the same call; ordering matters |
| Department directory | KV (`DEPARTMENT_KV`) | Shared, read on every call, rarely changes |
| `same_day_slots_enabled` flag | KV (`DEPARTMENT_KV`) | Can be switched without a redeploy |
| Available slots | Plain code (`mcp-server/src/lib/scheduling.ts`) | Computed from the clock; nothing to store |
| Webhook public key, SMS sender number | Secrets | Credentials, not application state |

## Conversation flow

Eight nodes, built in the Portal. The live flow is exported to
`docs/conversation-flow.json`.

| Node | Type | What it does |
|---|---|---|
| Disclosure | speak | Greeting, recording notice, what the line can do |
| Identify Intent | prompt | Classifies the request. Has no tools of its own |
| Existing Appointment Check | prompt | Looks up the caller by mobile number, reads back the appointment, reschedules or cancels it |
| Book Appointment | prompt | Department, name, available slots, booking, SMS confirmation |
| Admin FAQ | prompt | General questions about the departments; says so when it doesn't know |
| Emergency Escalation | speak | Tells the caller to hang up and dial 997 |
| Appointment Closing | speak | Goodbye |
| Close Call | tool | Hang up |

Identify Intent routes to Existing Appointment Check in two ways: directly
when the webhook reported `has_existing_appointment`, and through an LLM
condition whenever the caller asks about an appointment they already have.
The second route matters because MCP tools are available in every node: a
node's `tools` setting only governs its own inline tools. Without an
explicit route, the model would handle the request from Identify Intent
itself.

**Emergencies.** Identify Intent and Admin FAQ, the two open-ended nodes,
have an LLM edge to Emergency Escalation. The other nodes don't.

## MCP tools

| Tool | Purpose |
|---|---|
| `get_patient_status` | Name, call count, and current appointment for a phone number |
| `get_available_slots` | Next five slots for a department (the department is a parameter) |
| `book_appointment` | Book a slot and save the patient's name |
| `reschedule_or_cancel_appointment` | Move or cancel the current appointment |
| `send_appointment_confirmation_sms` | Text the booked appointment to the patient |
| `reset_patient_state` | Admin/demo only; not in the assistant's allowed tools |

A single server serves all three departments, because every scheduling
tool takes the department as a parameter.

**Phone numbers.** `lib/phone.ts` normalizes Saudi mobiles (`05…`, `5…`,
`9665…`) and US/NANP numbers to E.164. Portal browser-test callers
(`name@sip.telnyx.eu`) are mapped to a key containing only letters, digits
and underscores (`sip_name_sip_telnyx_eu`).

**Slots.** Sunday to Thursday, at 10:00, 12:00, 14:00 and 16:00 Riyadh time
(stored as 07:00, 09:00, 11:00 and 13:00 UTC), starting the next business
day. Same-day slots are offered when the KV flag is on.

## Voice and model

- **LLM: Kimi K2.6.** It gave the lowest end-to-end latency
  (speech-to-text, then LLM, then text-to-speech) with good answers and
  reliable tool calling. Qwen 235B also performed well but was slower.
  GLM didn't produce usable turns.
- **Voice: Telnyx Ultra. Transcription: `azure/fast` (en-US).** Chosen for
  latency. The Humain "Abdulaziz" voice sounded more natural to Arabic
  speakers, but added latency.
- **English only.** In a hospital setting, Arabic speakers switch to
  English medical terms mid-sentence, so relying on automatic
  code-switching gives unreliable transcripts. A language choice at the
  start of the call (IVR) would support Arabic cleanly, with a dedicated
  Arabic assistant behind it.

## Setup

Requires Node.js, npm, and the `telnyx-edge` CLI (v0.5.4 was used).

1. Install and test:
   ```
   (cd webhook-function && npm install && npm test)
   (cd mcp-server && npm install && npm test)
   ```
2. Create both functions. Run `new-func` from an empty folder, because it
   writes a template project, then copy each printed `[edge_compute]` block
   (`func_id`, `func_name`) into the matching `telnyx.toml`:
   ```
   telnyx-edge new-func --language ts --name hospital-webhook-v2
   telnyx-edge new-func --language ts --name hospital-mcp-v2
   ```
3. Create the secrets on the account (`telnyx-edge secrets`):
   `TELNYX_PUBLIC_KEY` (the webhook signing public key) and
   `HOSPITAL_SMS_FROM_NUMBER` (the sender number, in E.164). Set the KV
   namespace id under `[storage.kv.DEPARTMENT_KV]` in both `telnyx.toml`
   files.
4. Generate the binding types, then deploy. The webhook goes first, since
   it owns the actor type:
   ```
   (cd webhook-function && telnyx-edge types && telnyx-edge ship)
   (cd mcp-server && telnyx-edge types && telnyx-edge ship)
   ```
5. Check both functions:
   ```
   telnyx-edge bindings validate
   curl https://<webhook-host>/health
   curl https://<mcp-host>/health
   ```
6. In the Portal:
   - Set the assistant's **Dynamic Variables Webhook URL** to the webhook
     host.
   - Add an **MCP server** with the MCP function's host (no path) and allow
     the five caller-facing tools.
   - Build the flow from `docs/conversation-flow.json`. To load it via the
     API, send `POST /v2/ai/assistants/<id>` with `{"conversation_flow": …}`.
   - Assign the phone number.
7. After editing the flow, run `python3 docs/validate_flow.py`. It checks
   that every edge resolves, every node is reachable, speak nodes have
   exactly one default edge, and nothing dead-ends except the hang-up.

## Operations

### Knowing it's broken within a minute

1. **`/health` on both functions.** It returns `"ok": false` and names the
   failing dependency, KV or actor, in about a second, without placing a
   call. It can be polled every 30 seconds by any uptime checker.
2. **Failure events in the logs.** Every webhook call and tool call logs
   `<event>.success` or `<event>.failure` with `duration_ms`. A run of
   `.failure` lines, or `duration_ms` values near 30000 (the signature of
   the actor outage), shows up in `telnyx-edge logs <function> --since 5m`.
3. **The caller's side.** A lookup that fails shows up in the Portal
   transcript as a `tool_timeout`, and the assistant apologises instead of
   reading back the record.

**What to look at first:** `/health?actor=1` on the webhook. It separates
the three failure modes seen so far in one request: KV authentication
(`401`), KV key format (`400`), and the actor never answering (`timeout`).
Then the webhook logs, filtered by the call's `correlation_id`.

### Commands

| Task | Command |
|---|---|
| Health (KV) | `curl https://<host>/health` |
| Health (KV and actor, 8 s cap) | `curl "https://<host>/health?actor=1"` |
| Logs | `telnyx-edge logs <function> --since 15m` |
| Metrics | `telnyx-edge metrics <function>` |
| KV credential | `telnyx-edge bindings validate`; if invalid, `telnyx-edge bindings update` |
| Actor types and owners | `telnyx-edge actors list` |

`/health` touches only synthetic keys, so it needs no secret. Logs are
single-line JSON, `{level, event, timestamp, …}`. `withTiming` logs
`<event>.success` or `<event>.failure` with `duration_ms`, and a handler
that returns an HTTP 5xx or an MCP tool error counts as a failure. Each
call gets a `correlation_id`, which is logged on every line and passed to
the assistant as a dynamic variable.

## Tests

- 34 unit tests (`npm test`): phone normalization, the KV record store
  (including key format and uniqueness), `/health`, and slot generation.
  Both projects type-check with `tsc --noEmit`.
- `docs/validate_flow.py` checks the structure of the conversation flow.
- End-to-end on the live number (2026-09-27): intent routing, lookup,
  booking, the confirmation SMS, and a second call finding the booking.

## Known issues

- **Appointment times are read out inconsistently.** Slots are stored
  correctly in UTC, but the model converts them to Riyadh time itself and
  gets it wrong. A 13:00 UTC slot (4 PM Riyadh) was offered as "2 PM" and
  later read back as "1 PM". The confirmation SMS shows the raw UTC
  timestamp. The fix: tools return a ready-made Riyadh-time `displayTime`
  with every slot and appointment, the model reads it out as written and
  passes `slotTime` back unchanged, and the SMS and webhook use the same
  label. The assistant's base prompt should also state the current time in
  `Asia/Riyadh`, not `America/Los_Angeles`.
- **Patient records are on the KV fallback** until actor calls work again.
  See "Patient records" above for the trade-off.
- **The KV credential can expire.** `telnyx-edge bindings validate` shows
  its state, and `bindings update` renews it.

## Incident: Stateful Actor calls failing account-wide (since 2026-09-26)

**Symptom.** Every actor call hangs about 30 seconds, then fails with
`actor invocation <account>__PatientActor/<id>.<method> returned 502: bad
gateway`. The same calls completed in 1 to 2 seconds between 2026-09-25
22:37 and 2026-09-26 00:23 UTC. The first recorded failure is 2026-09-26
22:18 UTC.

**Isolation:**

| Test | Result |
|---|---|
| Called from the owning function and from the referencing function | Both fail |
| Different methods (`getProfile`, `recordCallStart`) | All fail |
| A never-used instance id | Fails |
| New functions with a new actor type (`PatientActorV2`) | Fails on the first call |
| The original project code | Same actor calls, config, and library versions as what is deployed |
| Owning function's logs | Pod running and serving HTTP; the call goes out to the actor router (`actor-router…svc:8081`) and never reaches the actor |

**Account state.** An early test function, `scratch-actor-check`, owns an
actor type (`Counter`). Its deletion failed on 2026-09-26 at 17:22 UTC and
it can't be removed now: `actors delete Counter` refuses while the function
still binds it, and `reset-func` returns the function to `delete_failed`.
Telnyx also doesn't allow rollback for functions that own an actor type.

**Possible trigger.** From 2026-09-26, browser-test caller identities such
as `lnxxs9gu@sip.telnyx.eu` were used directly as actor ids. That produced
addresses like `…/PatientActor/lnxxs9gu@sip.telnyx.eu.recordCallStart`,
where the id contains the `.` that separates id from method. Failures
started after that change. It isn't confirmed as the cause, since the new
actor type failed without ever receiving such an id. Ids are now limited to
letters, digits, `_` and `+`.

**Next step:** report to Telnyx with the evidence above, and ask for the
actor router for this account to be checked and the stuck function and
`Counter` type removed.

## Other issues along the way

- **opencode plugin.** `@telnyx/opencode` failed to load under opencode
  v2.0.16 (`Plugin must export a default definition…`); the plugin targets
  `@opencode-ai/plugin@^1.2.27`. Solved by configuring Telnyx Inference
  directly as an OpenAI-compatible provider in `opencode.json`. The
  project was built with opencode on Telnyx Inference (Kimi K2.6); the
  later debugging and the KV fallback were done with Claude.
- **Phone number.** The provided purchase path didn't complete, so the
  number was bought directly on the account.
- **KV key format.** A key containing `:` failed with `400 Invalid key
  format`. Keys now use only characters KV allows.
- **KV authentication.** KV calls returned `401 token expired`. Fixed with
  `telnyx-edge bindings update`, without a redeploy.
- **Partial phone numbers.** The model called `get_patient_status` while
  the caller was still reading out digits (`"05"`, then `"45678"`). The
  tool description now tells it to wait for a complete number and lists
  the valid formats.

## Repository

```
webhook-function/   dynamic-variables webhook; ships PatientActorV2
  src/index.ts                 webhook handler and /health
  src/actors/patientActor.ts   the actor
  src/lib/patientRecords.ts    actor/KV switch and KV store (shared with mcp-server)
  src/lib/phone.ts             caller id normalization
  src/lib/kv.ts                department directory and feature flag
  src/lib/health.ts            /health
  src/lib/logger.ts            JSON logs and timing
mcp-server/         MCP tools and /health
  src/lib/patientActorClient.ts  patient-record calls
  src/lib/scheduling.ts          slot generation
  src/lib/telnyxApi.ts           SMS
docs/               live conversation flow and its validator
opencode.json       Telnyx Inference provider for opencode
```

## Design history

The project started as an HR pre-screening agent. It became a hospital
scheduling line to exercise more of the platform: a branching conversation
flow (check, book, reschedule, cancel, FAQ, emergency), parameterized MCP
tools, state shared between two functions, and an emergency path.
