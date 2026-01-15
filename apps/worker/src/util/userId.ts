export function normalizeUserId(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error("missing_user_id");

  // If it came as "123.0" or similar, take the integer part.
  const base = s.split(".")[0] ?? "";

  // Keep digits only (Telegram user id is numeric).
  const digits = base.replace(/[^\d]/g, "");
  if (!digits) throw new Error("invalid_user_id");

  return digits;
}
