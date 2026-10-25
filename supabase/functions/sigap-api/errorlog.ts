// deno-lint-ignore-file no-explicit-any
import { getSession } from "./logic.ts";
export const ERR_MAX_PESAN = 500;
export const ERR_MAX_DETAIL = 2000;
export const ERR_MAX_HALAMAN = 500;
export const ERR_MAX_PER_MENIT = 60;
export function bersihkan(v: unknown, max: number): string {
const s = v === undefined || v === null || v === false || v === 0 || v === "" ? "" : String(v);
// deno-lint-ignore no-control-regex
return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max);
}
export async function doLogClientError(sql: any, body: any) {
try {
let nama = "(sesi tidak valid)";
let guruId: string | null = null;
try {
const s = await getSession(sql, body?.sessionToken);
if (s) { nama = s.user.name; guruId = s.user.id; }
} catch (_e) { /* tetap catat sebagai sesi tidak valid */ }
const n = await sql`select count(*)::int as n from sigap.error_log where waktu > now() - interval '1 minute'`;
if (n[0].n < ERR_MAX_PER_MENIT) {
await sql`insert into sigap.error_log (nama, guru_id, pesan, detail, halaman)
values (${nama}, ${guruId}, ${bersihkan(body?.message, ERR_MAX_PESAN)}, ${bersihkan(body?.detail, ERR_MAX_DETAIL)}, ${bersihkan(body?.page, ERR_MAX_HALAMAN)})`;
}
} catch (_e) { /* diamkan — lihat catatan di atas */ }
return { status: "success" };
}
