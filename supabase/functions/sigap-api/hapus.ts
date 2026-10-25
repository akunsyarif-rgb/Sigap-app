// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
import { isAdmin } from "./data.ts";
export const HAPUS_MAX_ROWS = 3000;
const MAX_DAYS = 366;
const TZ = "Asia/Makassar";
type Jenis = { label: string; table: string };
const JENIS: Record<string, Jenis> = {
keterlambatan: { label: "Keterlambatan", table: "sigap.terlambat" },
pelanggaran: { label: "Pelanggaran", table: "sigap.pelanggaran" },
surat: { label: "Surat/Izin", table: "sigap.surat_masuk" },
izin: { label: "Izin Keluar", table: "sigap.izin_keluar" },
upacara: { label: "Pelanggaran Upacara", table: "sigap.pelanggaran_upacara" },
};
const MSG_PREVIEW_ADMIN = "Hanya admin yang bisa melihat pratinjau penghapusan data.";
const MSG_HAPUS_ADMIN = "Hanya admin yang bisa menghapus data.";
const MSG_JENIS = "Pilih minimal satu jenis data.";
const MSG_CONFIRM = "Konfirmasi penghapusan diperlukan.";
class Batal extends Error {
constructor(public msg: string, public total: number) { super(msg); }
}
function pad(n: number) { return n < 10 ? "0" + n : String(n); }
function parseTgl(v: unknown): { y: number; m: number; d: number; ms: number } | null {
const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(v ?? "").trim());
if (!m) return null;
const y = +m[1], mo = +m[2], d = +m[3];
const dt = new Date(Date.UTC(y, mo - 1, d));
if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
return { y, m: mo, d, ms: dt.getTime() };
}
export function validatePeriode(start: unknown, end: unknown):
{ ok: true; iso: [string, string]; label: string } | { ok: false; message: string } {
const a = parseTgl(start), b = parseTgl(end);
if (!a || !b) return { ok: false, message: "Tanggal tidak valid. Isi tanggal mulai dan tanggal akhir." };
if (a.ms > b.ms) return { ok: false, message: "Tanggal mulai tidak boleh melewati tanggal akhir." };
const hari = Math.floor((b.ms - a.ms) / 86400000) + 1;
if (hari > MAX_DAYS) return { ok: false, message: `Rentang terlalu panjang (maksimal ${MAX_DAYS} hari). Persempit periodenya.` };
const iso = (x: typeof a) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;
return { ok: true, iso: [iso(a), iso(b)], label: `${pad(a.d)}/${pad(a.m)}/${a.y} - ${pad(b.d)}/${pad(b.m)}/${b.y}` };
}
export function normalizeJenis(input: unknown): string[] {
const list = Array.isArray(input) ? input : (typeof input === "string" ? input.split(",") : []);
const seen = new Set<string>();
const out: string[] = [];
for (const x of list) {
const k = String(x ?? "").trim();
if (k && Object.hasOwn(JENIS, k) && !seen.has(k)) { seen.add(k); out.push(k); }
}
return out;
}
function auditDetail(jenisList: string[], periode: string, counts: Record<string, number>, total: number, status: string) {
const rincian = jenisList.map((j) => `${JENIS[j].label}=${counts[j] ?? 0}`).join(", ");
return `periode=${periode} | jenis=${rincian || "-"} | total=${total} | status=${status}`;
}
const KOND = `(dicatat_pada at time zone '${TZ}')::date between $1::date and $2::date`;
async function hitung(db: any, jenisList: string[], iso: [string, string]) {
const counts: Record<string, number> = {};
let total = 0;
for (const j of jenisList) {
const r = await db.unsafe(`select count(*)::int as n from ${JENIS[j].table} where ${KOND}`, [iso[0], iso[1]]);
counts[j] = r[0].n;
total += r[0].n;
}
return { counts, total };
}
export async function hapusInti(tx: any, user: any, jenisList: string[], iso: [string, string], periode: string, maxRows = HAPUS_MAX_ROWS) {
for (const j of jenisList) await tx.unsafe(`lock table ${JENIS[j].table} in share row exclusive mode`);
if (jenisList.includes("izin")) await tx.unsafe("lock table sigap.izin_kelompok in share row exclusive mode");
const cek = await hitung(tx, jenisList, iso);
if (cek.total > maxRows) {
throw new Batal(`Data terlalu banyak (${cek.total} baris, batas ${maxRows}). Persempit periodenya lalu ulangi bertahap.`, cek.total);
}
const counts: Record<string, number> = {};
let total = 0;
let kelompokIds: string[] = [];
for (const j of jenisList) {
const q = `delete from ${JENIS[j].table} where ${KOND}` + (j === "izin" ? " returning kelompok_id" : "");
const r = await tx.unsafe(q, [iso[0], iso[1]]);
counts[j] = r.count ?? r.length;
total += counts[j];
if (j === "izin") kelompokIds = [...new Set(r.map((x: any) => x.kelompok_id).filter(Boolean))] as string[];
}
let kegiatanDibersihkan = 0;
if (kelompokIds.length) {
const r = await tx.unsafe(
`delete from sigap.izin_kelompok k where k.id in (select jsonb_array_elements_text($1::text::jsonb)::uuid)
and not exists (select 1 from sigap.izin_keluar i where i.kelompok_id = k.id)`,
[JSON.stringify(kelompokIds)]);
kegiatanDibersihkan = r.count ?? r.length;
}
await tx`insert into sigap.audit_log (nama, guru_id, aksi, detail) values (${user.name}, ${user.id},
${total ? "Hapus Data Massal" : "Hapus Data Massal Kosong"},
${auditDetail(jenisList, periode, counts, total, total ? "berhasil" : "tidak ada data")})`;
return { counts, total, kegiatanDibersihkan };
}
export async function doPreviewHapusData(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (!isAdmin(s.user)) return { status: "error", message: MSG_PREVIEW_ADMIN };
const p = validatePeriode(body?.start, body?.end);
if (!p.ok) return { status: "error", message: p.message };
const jenisList = normalizeJenis(body?.jenis);
if (!jenisList.length) return { status: "error", message: MSG_JENIS };
const { counts, total } = await hitung(sql, jenisList, p.iso);
return { status: "success", periodeLabel: p.label, counts, total };
}
export async function doHapusDataPeriode(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const user = s.user;
const rawPeriode = String(body?.start ?? "-").slice(0, 10) + " - " + String(body?.end ?? "-").slice(0, 10);
if (!isAdmin(user)) {
await audit(sql, user.name, user.id, "Hapus Data Ditolak", "alasan=unauthorized");
return { status: "error", message: MSG_HAPUS_ADMIN };
}
const p = validatePeriode(body?.start, body?.end);
if (!p.ok) {
await audit(sql, user.name, user.id, "Hapus Data Ditolak", `alasan=periode tidak valid | ${rawPeriode}`);
return { status: "error", message: p.message };
}
const jenisList = normalizeJenis(body?.jenis);
if (!jenisList.length) {
await audit(sql, user.name, user.id, "Hapus Data Ditolak", `alasan=jenis tidak dipilih | periode=${p.label}`);
return { status: "error", message: MSG_JENIS };
}
if (body?.confirm !== true) return { status: "error", message: MSG_CONFIRM };
try {
const r = await sql.begin((tx: any) => hapusInti(tx, user, jenisList, p.iso, p.label));
return { status: "success", periodeLabel: p.label, counts: r.counts, total: r.total };
} catch (e) {
if (e instanceof Batal) {
await audit(sql, user.name, user.id, "Hapus Data Gagal", auditDetail(jenisList, p.label, {}, e.total, "melebihi batas baris"));
return { status: "error", message: e.msg };
}
throw e; // error tak terduga: transaksi sudah rollback; index.ts membalas pesan umum
}
}
