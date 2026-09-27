/**
 * Resolves a caller identifier to the stable string used as the
 * PatientActor key (and, for real phone numbers, the SMS destination).
 *
 * Three distinct shapes reach this in practice, each handled in its own
 * way rather than forced through one phone-shaped regex:
 *
 *   1. Saudi mobile numbers -- the product's primary audience.
 *        "05XXXXXXXX"    (national, with trunk 0)
 *        "5XXXXXXXX"     (national, no trunk 0)
 *        "9665XXXXXXXX"  (country code, no +)
 *        "+9665XXXXXXXX" (already E.164)
 *      -> normalized to E.164 (+9665XXXXXXXX).
 *
 *   2. US / NANP numbers -- e.g. calls placed from a US number (interview
 *      test calls dial in from the US).
 *        "XXXXXXXXXX"    (10-digit local; area code can't start 0/1,
 *                          which also keeps this from ever colliding with
 *                          the 9- or 10-digit Saudi shapes above)
 *        "1XXXXXXXXXX"   (country code, no +)
 *        "+1XXXXXXXXXX"  (already E.164)
 *      -> normalized to E.164 (+1XXXXXXXXXX).
 *
 *   3. Telnyx's in-Portal browser test client, which puts a SIP identity
 *      in the caller-ID field instead of a phone number when the
 *      assistant is tested from the browser rather than a real call --
 *      e.g. "lnxxs9gu@sip.telnyx.eu". Not a phone number at all, so it's
 *      mapped to a punctuation-free key (see sipIdentityKey) rather than
 *      run through phone-shape regexes it can never match.
 *      SMS confirmation will legitimately fail for these -- there's no
 *      dialable number behind a SIP test identity -- and that's expected,
 *      not a bug; `send_appointment_confirmation_sms` already surfaces
 *      that as a clean tool error instead of crashing.
 *
 * Throws only when none of the three shapes match, so callers (the
 * webhook handler) can treat a throw as "couldn't resolve this caller"
 * and fail open with defaults.
 */
/**
 * Stable, punctuation-free key for a SIP test identity:
 *   "lnxxs9gu@sip.telnyx.eu" -> "sip_lnxxs9gu_sip_telnyx_eu"
 *
 * Why not the raw URI: this string becomes an actor instance id, and the
 * platform addresses actor calls as `<Type>/<id>.<method>` -- a "." (or
 * "@") inside the id makes that address ambiguous. Raw SIP URIs were sent
 * as actor ids from 2026-09-26, shortly before every actor call on the
 * account started failing; whether or not they caused it, ids here are now
 * restricted to [a-z0-9_+].
 */
export function sipIdentityKey(sipUri: string): string {
  return `sip_${sipUri.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

export function normalizeSaudiPhone(raw: string): string {
  const trimmed = raw.trim();

  // Case 3: SIP-URI-shaped test identity ("user@host.tld"), not a phone
  // number. Checked first so it never falls through to digit-stripping,
  // which would just silently produce an empty/garbage digit string.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return sipIdentityKey(trimmed);
  }

  const digitsOnly = trimmed.replace(/[^\d]/g, "");

  // --- Case 1: Saudi mobile ---

  // +9665XXXXXXXX or 9665XXXXXXXX
  if (/^9665\d{8}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }
  // 05XXXXXXXX
  if (/^05\d{8}$/.test(digitsOnly)) {
    return `+966${digitsOnly.slice(1)}`;
  }
  // 5XXXXXXXX
  if (/^5\d{8}$/.test(digitsOnly)) {
    return `+966${digitsOnly}`;
  }

  // --- Case 2: US / NANP ---

  // 1XXXXXXXXXX (country code, no +; area code can't start 0/1)
  if (/^1[2-9]\d{9}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }
  // XXXXXXXXXX (10-digit local; area code can't start 0/1)
  if (/^[2-9]\d{9}$/.test(digitsOnly)) {
    return `+1${digitsOnly}`;
  }

  // Already-E.164 number from neither region: pass through unchanged
  // rather than force a shape onto it -- the assistant can still take
  // calls from elsewhere.
  if (/^\+\d{8,15}$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid phone number: "${raw}"`);
}
