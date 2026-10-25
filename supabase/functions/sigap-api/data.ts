// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
export const EDIT_WINDOW_SECONDS = 5 * 60;
export const MSG_NO_ACCESS = "Tidak punya akses untuk aksi ini.";
export const MSG_UNAUTH = "Unauthorized";
export const MSG_NOT_FOUND = "Data tidak ditemukan (mungkin sudah diubah/dihapus pengguna lain).";
const MAX_ALASAN = 200;
const MAX_ROWS = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const role = (u: any) => String(u?.role ?? "").toLowerCase().trim();
export const isOsis = (u: any) => role(u) === "osis";
export const isAdmin = (u: any) => role(u) === "admin";
export const isBk = (u: any) => role(u) === "bk_kesiswaan";
export function cleanText(v: unknown, max: number): string {
if (typeof v !== "string") return "";
// deno-lint-ignore no-control-regex
return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}
function rowOut(r: any) {
return {
id: r.id,
timestamp: r.dicatat_pada,
nisn: r.nisn,
name: r.nama,
class: r.kelas,
type: r.alasan,
logged_by: r.dicatat_oleh,
};
}
export const TABEL: Record<string, string> = { terlambat: "sigap.terlambat", surat: "sigap.surat_masuk", pelanggaran: "sigap.pelanggaran" };
const HARI_INI = "tanggal = (now() at time zone 'Asia/Makassar')::date";
async function readScoped(sql: any, user: any, kategori: "terlambat" | "surat", nisn?: string) {
const tabel = TABEL[kategori];
const params: unknown[] = [];
const conds: string[] = [];
if (isAdmin(user) || isBk(user)) {
// seluruh sekolah
} else {
const wali = String(user.waliKelas ?? "").trim();
if (wali) {
params.push(wali);
conds.push(`(${HARI_INI} or (kelas_norm <> '' and kelas_norm = sigap.norm_kelas($${params.length}::text)))`);
} else {
conds.push(HARI_INI);
}
}
if (typeof nisn === "string" && nisn !== "") {
params.push(nisn);
conds.push(`nisn = $${params.length}::text`);
}
const where = conds.length ? " where " + conds.join(" and ") : "";
return await sql.unsafe(`select * from ${tabel}${where} order by dicatat_pada desc limit ${MAX_ROWS}`, params);
}
export async function doRecord(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "Siswa belum dipilih." };
const alasan = cleanText(body?.type, MAX_ALASAN);
const sw = await sql`select id, nisn, nama, kelas from sigap.siswa where nisn = ${nisn}`;
if (!sw.length) return { status: "error", message: "Siswa tidak ditemukan." };
const siswa = sw[0];
const ins = await sql`
insert into sigap.terlambat (siswa_id, nisn, nama, kelas, alasan, dicatat_oleh, dicatat_oleh_id)
values (${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${alasan}, ${s.user.name}, ${s.user.id})
on conflict on constraint terlambat_sekali_per_hari do nothing
returning id, dicatat_pada`;
if (!ins.length) return { status: "error", message: siswa.nama + " sudah tercatat terlambat hari ini." };
return { status: "success", id: ins[0].id, timestamp: ins[0].dicatat_pada };
}
export async function doGetLogs(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const rows = await readScoped(sql, s.user, "terlambat");
return { status: "success", logs: rows.map(rowOut) };
}
export async function doGetLateHistory(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "success", history: [], count: 0 };
const rows = await readScoped(sql, s.user, "terlambat", nisn);
return {
status: "success",
history: rows.map((r: any) => ({ timestamp: r.dicatat_pada, type: r.alasan })),
count: rows.length,
};
}
export const MAX_JENIS = 100;
export const MAX_KET = 500;
function suratOut(r: any) {
return {
id: r.id,
timestamp: r.dicatat_pada,
nisn: r.nisn,
name: r.nama,
class: r.kelas,
jenis: r.jenis,
keterangan: r.keterangan,
foto_url: r.foto_url ?? "",
logged_by: r.dicatat_oleh,
};
}
export async function doAddSurat(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "Siswa belum dipilih." };
const jenis = cleanText(body?.jenis, MAX_JENIS);
if (!jenis) return { status: "error", message: "Jenis surat belum diisi." };
const keterangan = cleanText(body?.keterangan, MAX_KET);
const sw = await sql`select id, nisn, nama, kelas from sigap.siswa where nisn = ${nisn}`;
if (!sw.length) return { status: "error", message: "Siswa tidak ditemukan." };
const siswa = sw[0];
const ins = await sql`
insert into sigap.surat_masuk (siswa_id, nisn, nama, kelas, jenis, keterangan, dicatat_oleh, dicatat_oleh_id)
values (${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${jenis}, ${keterangan}, ${s.user.name}, ${s.user.id})
on conflict on constraint surat_sekali_per_hari do nothing
returning id, dicatat_pada`;
if (!ins.length) return { status: "error", message: siswa.nama + " sudah punya catatan surat hari ini." };
return { status: "success", id: ins[0].id, timestamp: ins[0].dicatat_pada };
}
export async function doGetSurat(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const rows = await readScoped(sql, s.user, "surat");
return { status: "success", surat: rows.map(suratOut) };
}
async function loadForChange(sql: any, user: any, body: any, verb: "mengubah" | "menghapus") {
if (isOsis(user)) return { err: MSG_NO_ACCESS };
const kategori = body?.category;
if (kategori !== "terlambat" && kategori !== "surat" && kategori !== "pelanggaran") {
return { err: ["izin"].includes(kategori) ? "Kategori ini belum tersedia di sistem baru." : "Kategori tidak dikenali." };
}
const id = typeof body?.id === "string" ? body.id.trim() : "";
if (!UUID_RE.test(id)) return { err: MSG_NOT_FOUND };
const r = await sql.unsafe(
`select t.*, extract(epoch from (clock_timestamp() - t.dicatat_pada)) as umur_detik from ${TABEL[kategori]} t where t.id = $1::uuid`,
[id],
);
if (!r.length) return { err: MSG_NOT_FOUND };
const row = r[0];
if (!isAdmin(user)) {
if (Number(row.umur_detik) > EDIT_WINDOW_SECONDS) {
return { err: "Sudah lewat 5 menit sejak dicatat — tidak bisa " + (verb === "mengubah" ? "diubah" : "dihapus") + " lagi." };
}
const pemilik = row.dicatat_oleh_id ? row.dicatat_oleh_id === user.id : row.dicatat_oleh === user.name;
if (!isBk(user) && !pemilik) {
return { err: "Cuma bisa " + verb + " catatan yang Anda tulis sendiri." };
}
}
return { row, kategori };
}
export async function doEditEntry(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const c: any = await loadForChange(sql, s.user, body, "mengubah");
if (c.err) return { status: "error", message: c.err };
if (c.kategori === "pelanggaran") {
const jenis = cleanText(body?.jenis_pelanggaran, MAX_JENIS);
if (!jenis) return { status: "error", message: "Jenis pelanggaran belum diisi." };
await sql`update sigap.pelanggaran set jenis_pelanggaran = ${jenis}, sanksi = ${cleanText(body?.sanksi, MAX_JENIS)}, catatan = ${cleanText(body?.catatan, MAX_KET)} where id = ${c.row.id}`;
} else if (c.kategori === "surat") {
const jenis = cleanText(body?.jenis, MAX_JENIS);
if (!jenis) return { status: "error", message: "Jenis surat belum diisi." };
const keterangan = cleanText(body?.keterangan, MAX_KET);
await sql`update sigap.surat_masuk set jenis = ${jenis}, keterangan = ${keterangan} where id = ${c.row.id}`;
} else {
const alasan = cleanText(body?.type, MAX_ALASAN);
await sql`update sigap.terlambat set alasan = ${alasan} where id = ${c.row.id}`;
}
await audit(sql, s.user.name, s.user.id, "Edit Data " + c.kategori, c.row.nama + " (" + c.row.nisn + ")");
return { status: "success" };
}
export async function doDeleteEntry(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const c: any = await loadForChange(sql, s.user, body, "menghapus");
if (c.err) return { status: "error", message: c.err };
if (c.kategori === "pelanggaran") await sql`delete from sigap.pelanggaran where id = ${c.row.id}`;
else if (c.kategori === "surat") await sql`delete from sigap.surat_masuk where id = ${c.row.id}`;
else await sql`delete from sigap.terlambat where id = ${c.row.id}`;
await audit(sql, s.user.name, s.user.id, "Hapus Data " + c.kategori, c.row.nama + " (" + c.row.nisn + ")");
return { status: "success" };
}
