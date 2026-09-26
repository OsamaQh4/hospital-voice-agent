# Hospital Appointments Voice Assistant

A Telnyx AI Assistant that answers a hospital's main line in Arabic and
English (mid-call code-switching), and handles **administrative** scheduling
across three departments -- General Medicine, Pediatrics, and Dental:
booking, rescheduling, cancelling, and general FAQ (hours, location,
billing, what to bring). It does not answer clinical/medical questions and
it is not an emergency line -- both are stated up front and enforced in the
workflow (see "Safety net" below).

Built for the Telnyx Forward Deployed Engineer take-home. This repo is the
rebuilt, hospital/multi-department version of an earlier HR-screening
prototype (same architecture, different domain) -- see "Design history"
at the bottom for why it changed.

## Architecture

```
                         ┌─────────────────────────┐
   PSTN call ──────────► │  Telnyx AI Assistant      │
                         │  (Conversation Workflow)  │
                         └─────────┬─────────┬───────┘
                                   │         │
                    dynamic_variables_webhook_url   mcp_servers
                          (call start only)     (throughout the call)
                                   │         │
                                   ▼         ▼
                    ┌──────────────────┐   ┌─────────────────────┐
                    │ webhook-function  │   │   mcp-server          │
                    │ (Edge Function)   │   │  (Edge Function,      │
                    │                   │   │   Streamable HTTP MCP)│
                    └─────────┬─────────┘   └──────────┬───────────┘
                              │                          │
                     idFromName(phone) ────────┬──────── idFromName(phone)
                              │                 │
                              ▼                 ▼
                    ┌───────────────────────────────────┐
                    │   PatientActor (Stateful Actor)     │
                    │   one instance per phone number      │
                    │   -- Shared Actor: class shipped by  │
                    │      webhook-function, reused by      │
                    │      mcp-server via a type-only       │
                    │      import + matching telnyx.toml    │
                    │      `type`                            │
                    └───────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────────────────────┐
                    │  DEPARTMENT_KV                       │
                    │  - department directory (cache)      │
                    │  - SAME_DAY_SLOTS_ENABLED flag        │
                    └───────────────────────────────────┘
```

Two independently-deployed Edge Functions, one shared durable actor type,
one KV namespace. `telnyx.messages.send` (via the pre-authenticated
`[telnyx]` binding) sends confirmation SMS; `telnyx.webhooks.unwrap`
verifies the dynamic-variables webhook's Ed25519 signature.

## Why Actor / KV / plain logic -- for every piece of state

This is the question the challenge grades directly, so it's answered per
piece of state rather than once in the abstract:

| State | Where | Why |
|---|---|---|
| A patient's name, current appointment, call count | **PatientActor** (Stateful Actor), keyed by phone number | Written by *two* independently-deployed projects in the same conversation (the webhook on call start, the MCP tools mid-call), sometimes within a second of each other. An Actor's per-id single-threaded execution makes "read current appointment, then write a changed one" atomic for free. A KV value would need hand-rolled optimistic-concurrency retries to avoid a lost update; a database would need the same, or explicit row locking. The phone number *is* the actor id (`this.ctx.id`), so there's no separate lookup step either. |
| Department directory (names, referral/walk-in policy) | **KV** (`DEPARTMENT_KV`) | Read on every call, changes rarely (a new department, a policy change), and has no per-caller identity -- the textbook KV cache case. Stale-by-a-few-seconds is fine; there is no "write" contention to protect against. |
| `SAME_DAY_SLOTS_ENABLED` feature flag | **KV** (`DEPARTMENT_KV`) | Same shape as the directory: global, rarely-written, read-heavy, no serialization need. A KV flag (not a code constant) so ops can turn same-day booking off during a staffing shortage without a redeploy. |
| Appointment slot availability | **Plain logic** (`nextAvailableSlots` in `mcp-server/src/lib/scheduling.ts`) | Deterministic, stateless, computed from the clock -- there's nothing to persist. A real deployment would call the hospital's practice-management system here instead; that's the one scope cut below, not a state-placement mistake. |
| Ed25519 webhook public key | **Secret** (`[[secrets]] TELNYX_PUBLIC_KEY`) | A credential, not application state -- belongs in `[[secrets]]`, read via `env.SECRETS.get(...)`, never in KV or code. |

The one-line version: **Actor** when the same record is read-and-written by
more than one caller in the same conversation and correctness depends on
ordering; **KV** when it's shared, cache-shaped, and no single caller owns
it; **plain logic** when there's nothing to persist at all.

## Why one MCP server, not three

`get_available_slots`, `book_appointment`, and
`reschedule_or_cancel_appointment` all take **`department` as a parameter**
(`"general_medicine" | "pediatrics" | "dental"`), not as three separate
tool sets or three separate servers. One MCP server, six tools, scoped per
workflow node (the demo/admin `reset_patient_state` tool is scoped only to
a node outside the caller-facing flow, so it's never reachable from
ordinary conversation).

This also means the **conversation workflow graph doesn't fork three ways
per department** -- there's one "new booking" shape and one "reschedule"
shape, each asking which department as a normal conversational turn, not
as a structural branch. See `docs/conversation-flow.json`'s
`_design_notes.department_as_parameter` for the one place this still shows
up as two thin node pairs (`n_get_slots_new`/`n_get_slots_reschedule`,
`n_offer_slots_new`/`n_offer_slots_reschedule`) -- an artifact of Telnyx
tool nodes routing to a fixed next node, not of department duplication.

## Safety net (and its stated limit)

Every call opens with a disclosure that this line is for scheduling/general
info only and names the Saudi emergency number, 997. On top of that, an
LLM-condition edge for emergency language is checked **first** (before any
other routing) on exactly two nodes: `n_identify_intent` (every call passes
through it) and `n_admin_faq` (the other open-ended node where a caller
could raise something urgent mid-question). It is **not** wired onto every
node in the graph -- an emergency mentioned deep inside, say, the
slot-selection prompt wouldn't trigger it. That's a stated limitation, not
a hidden gap: the two chosen nodes cover the points where a caller is
actually free to say anything, and adding the same edge everywhere else
would 2x the edge count for turns that are already narrow, closed
questions ("which time works?").

## Scope cuts (deliberate, not oversights)

- **Mocked calendar.** `nextAvailableSlots` is a deterministic generator
  (Sun-Thu, 10/11/13/14/15 local, Asia/Riyadh), not a real
  practice-management system integration. Every slot it returns follows
  the same fixed daily pattern, so it can't be mistaken for a real
  schedule if someone reads the code.
- **One current appointment per patient, not a history array.** A second
  booking overwrites the first rather than appending. Simpler Actor state,
  and matches this being a scheduling front door, not the system of
  record.
- **Telnyx Messaging, not a third-party SMS provider.** One vendor, one
  credential, consistent with everything else being Telnyx-native.
- **No email/`send_followup_email` tool.** SMS confirmation only, to keep
  the tool count and the demo focused.

## Setup

1. `cd webhook-function && npm install && npm run typecheck`
2. `cd mcp-server && npm install && npm run typecheck`
3. Deploy both with `telnyx-edge ship` (from each project directory).
4. In the Portal, create secrets:
   - `webhook-function`: `TELNYX_PUBLIC_KEY` (Mission Control -> Webhooks ->
     Ed25519 public key, base64).
   - `mcp-server`: `HOSPITAL_SMS_FROM_NUMBER` (the assistant's Telnyx
     number, E.164).
5. Point the AI Assistant's `dynamic_variables_webhook_url` at the deployed
   `webhook-function` URL, and add the deployed `mcp-server` URL under
   `mcp_servers`.
6. Build the Conversation Workflow in the Portal canvas using
   `docs/conversation-flow.json` as the reference graph (node/edge
   structure, instructions, tool wiring) -- see the note on that file
   below for why it's a reference rather than an import-ready payload.
7. Voice: Humain provider, voice "Abdulaziz", transcription model
   `humain/realtime`, transcription language "Arabic + English
   (Code-switching)" -- live-tested mid-conversation code-switching before
   this rebuild; carries over unchanged.
8. Completion model: **Qwen 235B**, picked from three live-tested
   candidates -- see "Model selection" below for the evaluation and the
   one fix it drove.
9. Run `python3 docs/validate_flow.py` after any edit to the workflow graph
   -- checks every edge resolves to a real node, every node is reachable,
   every speak node has exactly one default edge, the hangup node has
   none, and default edges evaluate last.

### About `docs/conversation-flow.json`

This was built and edited live in the Portal's workflow canvas (per the
challenge's own tooling), so this file is the **reviewable reference
form** of that graph -- structurally validated (`validate_flow.py`) and
schema-checked against Telnyx's documented node/edge shapes as of
2026-09-25 -- not a payload independently confirmed to import byte-for-byte
via the API. Two fields on tool/prompt nodes (`tool_name`, and per-node
`tools` scoping) are our best-effort naming: the docs describe per-node
tool scoping only as a Portal UI feature (a dropdown + checklist), not at
the JSON-field level, so those two names weren't independently verified
the way the node/edge/condition shapes were. Flagged in the file's own
`_design_notes.unverified_field`, not glossed over.

## Observability

- **Structured logs.** Every log line is single-line JSON
  (`{level, event, timestamp, ...fields}`) via `lib/logger.ts` in both
  projects -- Edge Compute has no platform log dashboard, so logs are read
  with `telnyx-edge logs <func> --tail`, and JSON keeps them greppable by
  `event` or `correlation_id`.
- **Latency signal.** `withTiming(event, fields, fn)` wraps every webhook
  invocation and every MCP tool call, emitting `<event>.success` or
  `<event>.failure` with `duration_ms`. `telnyx-edge metrics <func>` gives
  p50/p95/p99 on top of that.
- **Correlation ID.** Minted once per webhook call
  (`crypto.randomUUID()`), logged on every line for that call, and handed
  back to the assistant as a `correlation_id` dynamic variable so a demo
  walkthrough can pull one call's full trace across both functions from a
  single ID.

## Debugging story

**The `@telnyx/opencode` plugin failed to load**, blocking the
challenge's required Telnyx-Inference-via-OpenCode coding workflow before
any code was written. `opencode auth login telnyx` returned `Integration
not found: telnyx` (0 matches in the interactive picker). `opencode plugin
list` showed the plugin installed but with blank ID/VERSION columns --
the first sign it hadn't actually loaded. Re-running with
`--print-logs --log-level debug` surfaced the real error:

```
message="failed to load plugin" target=@telnyx/opencode
cause="Cause([Fail(PluginModule.LoadError: Plugin must export a default
definition with an id and an effect or setup function.
(cause: SchemaError(Expected object at [\"default\"])))])"
```

Cross-checked against the npm registry: `@telnyx/opencode@0.1.5` declares a
peer dependency on `@opencode-ai/plugin@^1.2.27`, while the installed CLI
was `opencode v2.0.16` -- a version-skew hypothesis consistent with the
schema error (the plugin's exported shape no longer matches what this CLI
version expects). Reported to the Telnyx contact with the exact log and
version numbers; work continued via the Portal's model picker in the
meantime (model selection is user-visible either way) so the build wasn't
blocked on a resolution.

**A second, still-open issue**: phone number provisioning. Saudi Arabia
numbers require full business KYC (trade license, 12-month commitment) --
expected and documented by Telnyx. A US (Washington DC) number was added
to cart and reached checkout, but the order did not complete: mid-checkout,
the account was prompted to "upgrade" via a LinkedIn login, and immediately
after, the *same* Buy Numbers flow reported the account as
Saudi-Arabia-only on a trial tier, while a Saudi Arabia search in that same
session returned "no search coverage in this country" -- a direct
platform-side contradiction, not a configuration mistake on this end.
Reported with the exact chronological sequence (pretrial -> cart -> upgrade
prompt -> post-upgrade contradiction); unresolved as of this rebuild. In
the meantime: confirmed Telnyx AI Assistants also support a WebSocket-based
voice interface for development/testing that doesn't require a phone
number, and confirmed via the challenge doc that a working phone number is
a hard submission requirement regardless (named three separate times), so
this is being tracked to resolution rather than designed around.

## Model selection

The Conversation Workflow's completion model (the LLM driving the live
phone conversation -- distinct from the `opencode.jsonc` model used to
*write* this code) was chosen by running the same booking scenario as a
real test call against the deployed workflow and reading back the Portal's
exported conversation transcript, not by spec comparison. Three candidates:

- **GLM** -- ruled out early; didn't produce usable turns in the workflow
  and wasn't pursued further once Kimi looked viable.
- **Kimi K2.6** -- completed conversations, but with repeated ~40-second
  dead-air stalls mid-call (the caller hears nothing while the model
  thinks) -- disqualifying for a live phone line regardless of eventual
  correctness.
- **Qwen 235B** -- selected. Never went dead-silent; the closest analog was
  asking the caller to repeat the available slots twice, each resolved
  within a few seconds. Completed a full existing-patient flow end to end
  (status lookup -> saw the existing Dental appointment -> booked a new
  General Medicine slot -> clean confirmation) with a correct booking and
  no dropped state.

Reading that transcript surfaced one real defect, fixed in this repo:
**`get_patient_status` was called on incomplete phone-number digits.** The
caller answered in fragments (`"of course it's zero five"`, then later
`"four five six seven eight"`), and the model called the tool after each
fragment instead of waiting for a complete number:

```
user      "of course it's zero five"
assistant [tool call] get_patient_status({"phone_number": "05"})
tool      "Invalid phone number: 05"
user      "four five six seven eight"
assistant [tool call] get_patient_status({"phone_number": "45678"})
tool      "Invalid phone number: 45678"
```

`mcp-server`'s `normalizeSaudiPhone` (`lib/phone.ts`) caught every one of
these cleanly and the model recovered each time rather than crashing, so
this was never a correctness bug -- but it's wasted tool round-trips and
awkward dead time on a real call. Fixed by tightening
`get_patient_status`'s tool description (`mcp-server/src/index.ts`) to
explicitly instruct the model to wait for a complete number -- and name
the valid Saudi shapes -- before calling it, rather than relying on the
model to infer that from a validation error after the fact.

A second, smaller observation from the same transcript -- the model moved
from "reschedule, cancel, or book an additional appointment?" straight
into checking General Medicine slots with no caller turn confirming
"additional" in between -- is noted but **not** treated as a confirmed bug:
it's equally consistent with a merged/dropped row in the CSV export as
with a real skipped confirmation, and wasn't reproduced on a second look.
Flagged here rather than fixed blind; worth watching for on the next live
test rather than acted on now.

## Known things to verify

Built without a live Telnyx account to run `telnyx-edge types` / `ship`
against, so the following were verified as far as static tooling allows,
and are flagged rather than silently assumed correct:

- **Verified against real, installed npm packages via `tsc --noEmit`** (both
  projects, zero errors) with a deliberate-typo check in each confirming
  the type-checker genuinely catches mistakes rather than silently
  passing: `@telnyx/edge-runtime@0.15.3`'s actual shipped `.d.ts` files
  (`StatefulActor`, `ActorNamespace`/`idFromName` returning a directly
  callable stub, `ActorStorage`, `KvNamespace`), and the real `telnyx@7.23.0`
  SDK's `webhooks.unwrap`/`TelnyxWebhookVerificationError` and
  `messages.send` shapes -- not assumed from memory. `Env` bindings are a
  hand-written `declare module` augmentation standing in for
  `telnyx-edge types`' generated file (documented inline in each
  `types.ts`).
- **Verified against fetched, current Telnyx docs (2026-09-25)**: the
  dynamic-variables webhook's exact request envelope
  (`data.payload.telnyx_end_user_target` etc.), its response contract
  (`{"dynamic_variables": {...}}`, ignored if not wrapped that way), its
  default/max timeouts (1.5s default, 10s max), and the conversation
  workflow's node/edge JSON shapes.
- **Not independently verified**: the exact runtime behavior of the
  ambient `env` singleton under concurrent requests on live Edge Compute
  (used consistently across both functions, grounded in the SDK's own
  documented usage pattern, but not exercised against a live deployment);
  the two `tool_name`/`tools` field names noted above; the actual demo
  phone number and MCP URL, pending the still-open account issue.

## Stretch goals

- **Shared Actors** -- `PatientActor` is owned by `webhook-function`,
  reused by `mcp-server` via a type-only cross-project import and a
  matching `telnyx.toml` `type` with no class shipped.
- **Variable-comparison edges**, including a compound one
  (`is_repeat_caller == "true" AND has_existing_appointment == "true"`)
  and tool-node routing on `telnyx_last_tool_status_code`.
- **KV feature flag** (`SAME_DAY_SLOTS_ENABLED`), toggleable without a
  redeploy.
- **Distributed tracing**, via the `correlation_id` minted in
  `webhook-function` and threaded through every log line in both
  functions.
- Not attempted this pass: multi-assistant routing, Actor alarms, object
  storage.

## Design history

This was originally an HR pre-screening voice agent (single job req,
single-turn screening call). Pivoted to hospital multi-department
appointments + administrative QA to exercise more of what the challenge
actually grades: a real multi-branch workflow (booking vs. reschedule vs.
cancel vs. FAQ vs. emergency, not one linear screening script), a
parameterized MCP tool set instead of a flat one, and a safety-relevant
edge case (the emergency escalation path) worth defending explicitly
rather than incidentally. The Saudi Arabic/English bilingual framing and
the voice/transcription configuration were validated in the Portal before
the pivot and carried over unchanged.
