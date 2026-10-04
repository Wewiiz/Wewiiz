import { validateSave, type SaveData } from "./schema";

export const SLOT_KEY = "baan-khong-rao.save.v1";
export const CORRUPT_BACKUP_KEY = "baan-khong-rao.save.corrupt-backup";

/** Minimal subset of the Web Storage API, so tests can pass an in-memory fake. */
export type KV = Pick<Storage, "getItem" | "setItem">;

export type ReadResult =
  | { status: "empty" }
  | { status: "ok"; data: SaveData }
  | { status: "corrupt"; message: string; detail: string[] }
  | { status: "unavailable"; message: string };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "corrupt-existing" | "invalid-data" | "unavailable"; message: string };

/** Returns localStorage, or null when the browser blocks it (private mode, disabled site data). */
export function browserStorage(): KV | null {
  try {
    const s = window.localStorage;
    const probe = "__probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function readSlot(kv: KV | null): ReadResult {
  if (!kv) return { status: "unavailable", message: "เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล (อาจเปิดโหมดส่วนตัวอยู่)" };
  let text: string | null;
  try {
    text = kv.getItem(SLOT_KEY);
  } catch {
    return { status: "unavailable", message: "อ่านข้อมูลเซฟจากเบราว์เซอร์ไม่ได้" };
  }
  if (text === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "corrupt", message: "ไฟล์เซฟเสียหาย อ่านไม่ออก", detail: ["JSON parse failed"] };
  }
  const v = validateSave(parsed);
  if (!v.ok) return { status: "corrupt", message: "ไฟล์เซฟมีค่าผิดปกติ จึงไม่โหลดเพื่อป้องกันความเสียหาย", detail: v.errors };
  return { status: "ok", data: v.data };
}

/**
 * Writes the save. If the slot currently holds a corrupt save, refuses unless
 * the player explicitly confirmed; even then the corrupt text is copied to a
 * backup key first so it is never silently lost.
 */
export function writeSlot(kv: KV | null, data: SaveData, opts: { overwriteCorrupt?: boolean } = {}): WriteResult {
  if (!kv) return { ok: false, reason: "unavailable", message: "เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล" };
  const check = validateSave(data);
  if (!check.ok) return { ok: false, reason: "invalid-data", message: "ข้อมูลเกมผิดปกติ จึงไม่บันทึกทับเซฟเดิม" };

  const existing = readSlot(kv);
  if (existing.status === "corrupt") {
    if (!opts.overwriteCorrupt)
      return { ok: false, reason: "corrupt-existing", message: "มีเซฟเดิมที่เสียหายอยู่ กดยืนยันอีกครั้งเพื่อบันทึกทับ (เซฟเสียจะถูกสำรองไว้)" };
    try {
      const old = kv.getItem(SLOT_KEY);
      if (old !== null) kv.setItem(CORRUPT_BACKUP_KEY, old);
    } catch {
      return { ok: false, reason: "unavailable", message: "สำรองเซฟเสียไม่ได้ จึงยังไม่บันทึกทับ" };
    }
  }

  try {
    kv.setItem(SLOT_KEY, JSON.stringify(data));
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable", message: "บันทึกไม่สำเร็จ พื้นที่เก็บข้อมูลของเบราว์เซอร์อาจเต็ม" };
  }
}
