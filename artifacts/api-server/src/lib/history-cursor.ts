export class HistoryCursorError extends Error {}
export type HistoryCursor = { at: string; id: string };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const historyCursor = (value: HistoryCursor) => Buffer.from(JSON.stringify(value)).toString("base64url");
export function parseHistoryCursor(value: unknown): HistoryCursor | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    if (typeof value !== "string" || value.length > 250 || !/^[\w-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.at !== "string" || typeof parsed.id !== "string" || !uuid.test(parsed.id) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/.test(parsed.at)) throw new Error();
    const date = new Date(parsed.at);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.at.slice(0, 10)) throw new Error();
    return { at: parsed.at, id: parsed.id };
  } catch { throw new HistoryCursorError("That history page is invalid. Refresh and try again."); }
}
