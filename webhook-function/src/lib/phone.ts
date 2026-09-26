export function normalizeSaudiPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (/^9665\d{8}$/.test(digits)) {
    return `+${digits}`;
  }

  if (/^05\d{8}$/.test(digits)) {
    return `+966${digits.slice(1)}`;
  }

  if (/^5\d{8}$/.test(digits)) {
    return `+966${digits}`;
  }

  if (/^\+\d{8,15}$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid phone number: ${raw}`);
}
