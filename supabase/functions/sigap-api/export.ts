// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
import { isAdmin, isBk } from "./data.ts";
export const EXPORT_SEKOLAH = "SMAN 2 Tarakan";
const MAX_ROWS = 5000;
const MAX_DAYS = 366;
const RATE_MAX = 20;
const RATE_WINDOW_MIN = 5;
const TZ = "Asia/Makassar";
const D = (c: string) => `to_char((${c} at time zone '${TZ}'), 'DD/MM/YYYY')`;
const T = (c: string) => `coalesce(to_char((${c} at time zone '${TZ}'), 'HH24:MI'), '')`;
const X = (c: string) => `coalesce(${c}, '')`;
const TGL = (c: string) => `(${c} at time zone '${TZ}')::date`;
type Def = {
label: string; judul: string; table?: string; level: "umum" | "bk"; columns: string[]; select?: string[];
};
const JENIS: Record<string, Def> = {
keterlambatan: {
label: "Keterlambatan", judul: "LAPORAN KETERLAMBATAN", table: "sigap.terlambat", level: "umum",
columns: ["Tanggal", "Jam", "Nama", "Kelas", "Keterangan", "Dicatat Oleh"],
select: [D("dicatat_pada"), T("dicatat_pada"), X("nama"), X("kelas"), X("alasan"), X("dicatat_oleh")],
},
pelanggaran: {
label: "Pelanggaran", judul: "LAPORAN PELANGGARAN", table: "sigap.pelanggaran", level: "umum",
columns: ["Tanggal", "Nama", "Kelas", "Jenis Pelanggaran", "Tindakan", "Catatan", "Dicatat Oleh"],
select: [D("dicatat_pada"), X("nama"), X("kelas"), X("jenis_pelanggaran"), X("sanksi"), X("catatan"), X("dicatat_oleh")],
},
surat: {
label: "Surat/Izin", judul: "LAPORAN SURAT / IZIN", table: "sigap.surat_masuk", level: "umum",
columns: ["Tanggal", "Nama", "Kelas", "Jenis", "Keterangan", "Dicatat Oleh"],
select: [D("dicatat_pada"), X("nama"), X("kelas"), X("jenis"), X("keterangan"), X("dicatat_oleh")],
},
bimbingan: {
label: "Bimbingan Khusus", judul: "LAPORAN BIMBINGAN KHUSUS", table: "sigap.bimbingan_khusus", level: "bk",
columns: ["Tanggal", "Nama", "Kelas", "Catatan", "Dicatat Oleh"],
select: [D("dicatat_pada"), X("nama"), X("kelas"), X("catatan"), X("dicatat_oleh")],
},
upacara: {
label: "Pelanggaran Upacara", judul: "LAPORAN PELANGGARAN UPACARA", table: "sigap.pelanggaran_upacara", level: "umum",
columns: ["Tanggal", "Nama", "Kelas", "Jenis Pelanggaran", "Catatan", "Dicatat Oleh"],
select: [D("dicatat_pada"), X("nama"), X("kelas"), X("jenis_pelanggaran"), X("catatan"), X("dicatat_oleh")],
},
izin: {
label: "Izin Keluar", judul: "LAPORAN IZIN KELUAR / PULANG", table: "sigap.izin_keluar", level: "umum",
columns: [
"Tanggal", "Nama", "Kelas", "Keperluan", "Tujuan", "Jalur", "Alasan Khusus", "Status",
"Disetujui Oleh", "Jam Setuju", "Verifikator", "Jam Keluar", "Jam Kembali", "Pencatat Kembali",
],
select: [
D("dicatat_pada"), X("nama"), X("kelas"), X("keperluan"),
`case when tujuan = 'pulang' then 'Pulang' when tujuan = 'kembali' then 'Kembali' else coalesce(tujuan,'') end`,
`case when jalur = 'khusus' then 'Khusus' else 'Normal' end`,
X("alasan_khusus"), X("status"), X("disetujui_oleh"), T("waktu_persetujuan"), X("diverifikasi_oleh"),
T("waktu_keluar"), T("waktu_kembali"), X("dicatat_kembali_oleh"),
],
},
rekap: {
label: "Rekap Siswa", judul: "REKAP SISWA", level: "umum",
columns: ["Nama", "Kelas", "Terlambat", "Pelanggaran", "Surat/Izin", "Upacara", "Total"],
},
};
const REKAP_SUMBER: [string, string][] = [
["t", "sigap.terlambat"], ["p", "sigap.pelanggaran"], ["s", "sigap.surat_masuk"], ["u", "sigap.pelanggaran_upacara"],
];
function pad(n: number) { return n < 10 ? "0" + n : String(n); }
function parseTgl(v: unknown): { y: number; m: number; d: number; ms: number } | null {
const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(v ?? "").trim());
if (!m) return null;
const y = +m[1], mo = +m[2], d = +m[3];
const dt = new Date(Date.UTC(y, mo - 1, d));
if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
return { y, m: mo, d, ms: dt.getTime() };
}
function detail(jenis: string, periode: string, cakupan: string, format: string, total: number, status: string) {
return `jenis=${jenis} | periode=${periode} | cakupan=${cakupan} | format=${format} | baris=${total} | status=${status}`;
}
export async function doExportData(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const user = s.user;
const rl = await sql`
select count(*)::int as n from sigap.audit_log
where guru_id = ${user.id} and aksi like 'Export Data%' and waktu > now() - make_interval(mins => ${RATE_WINDOW_MIN})`;
if (rl[0].n >= RATE_MAX) {
return { status: "error", message: "Terlalu banyak permintaan export. Coba lagi beberapa menit lagi." };
}
const jenis = String(body?.jenis ?? "").trim();
let format = String(body?.format ?? "").toLowerCase().trim();
if (format !== "pdf" && format !== "xlsx") format = "-";
const rawPeriode = String(body?.start ?? "-").slice(0, 10) + " - " + String(body?.end ?? "-").slice(0, 10);
const kelasReq = String(body?.kelas ?? "").trim().slice(0, 60);
const tolak = async (scope: string, status: string, msg: string, aksi = "Export Data Ditolak", periode = rawPeriode, fmt = format) => {
await audit(sql, user.name, user.id, aksi, detail(jenis || "-", periode, scope, fmt, 0, status));
return { status: "error", message: msg };
};
const def = Object.hasOwn(JENIS, jenis) ? JENIS[jenis] : null;
if (!def) return await tolak(kelasReq.slice(0, 40) || "-", "ditolak", "Jenis laporan tidak dikenali.");
if (String(user.role ?? "").toLowerCase().trim() === "osis") {
return await tolak(kelasReq.slice(0, 40) || "-", "ditolak", "Tidak punya akses export data.");
}
let kelasFilter = "";
let scope = "Semua Kelas";
if (isAdmin(user) || isBk(user)) {
kelasFilter = kelasReq;
scope = kelasReq || "Semua Kelas";
} else {
const wali = String(user.waliKelas ?? "").trim();
if (!wali) return await tolak(kelasReq.slice(0, 40) || "-", "ditolak", "Tidak punya akses export data.");
if (def.level === "bk") return await tolak(kelasReq.slice(0, 40) || "-", "ditolak", "Tidak punya akses untuk jenis laporan ini.");
if (kelasReq) {
const same = await sql`select sigap.norm_kelas(${kelasReq}::text) = sigap.norm_kelas(${wali}::text) as ok`;
if (!same[0].ok) return await tolak(kelasReq.slice(0, 40), "ditolak", "Hanya bisa mengekspor data kelas perwalian Anda.");
}
kelasFilter = wali;
scope = wali;
}
const a = parseTgl(body?.start), b = parseTgl(body?.end);
if (!a || !b) return await tolak(scope, "filter tidak valid", "Tanggal tidak valid. Isi tanggal mulai dan tanggal akhir.");
if (a.ms > b.ms) return await tolak(scope, "filter tidak valid", "Tanggal mulai tidak boleh melewati tanggal akhir.");
const hari = Math.floor((b.ms - a.ms) / 86400000) + 1;
if (hari > MAX_DAYS) {
return await tolak(scope, "filter tidak valid", `Rentang terlalu panjang (maksimal ${MAX_DAYS} hari). Persempit periodenya.`);
}
const periode = `${pad(a.d)}/${pad(a.m)}/${a.y} - ${pad(b.d)}/${pad(b.m)}/${b.y}`;
const iso = (x: typeof a) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;
if (format === "-") return await tolak(scope, "format tidak dikenali", "Format laporan tidak dikenali.", "Export Data Ditolak", periode, "-");
let rows: (string | number)[][];
if (jenis === "rekap") {
const sub = REKAP_SUMBER.map(([k, tbl]) =>
`select '${k}'::text as k, nisn, nama, kelas from ${tbl}
where ${TGL("dicatat_pada")} between $1::date and $2::date
and ($3::text = '' or sigap.norm_kelas(kelas) = sigap.norm_kelas($3::text))`).join(" union all ");
const q = `
select max(nama) as nama, max(kelas) as kelas,
count(*) filter (where k='t')::int as t, count(*) filter (where k='p')::int as p,
count(*) filter (where k='s')::int as s, count(*) filter (where k='u')::int as u
from (${sub}) x
group by coalesce(nullif(nisn,''), 'nama:' || coalesce(nama,'') || '|' || coalesce(kelas,''))
order by lower(max(kelas)), lower(max(nama))
limit ${MAX_ROWS + 1}`;
const r = await sql.unsafe(q, [iso(a), iso(b), kelasFilter]);
rows = r.map((x: any) => [x.nama ?? "", x.kelas ?? "", x.t, x.p, x.s, x.u, x.t + x.p + x.s + x.u]);
} else {
const q = `
select ${def.select!.map((e, i) => `${e} as c${i}`).join(", ")}
from ${def.table!}
where ${TGL("dicatat_pada")} between $1::date and $2::date
and ($3::text = '' or sigap.norm_kelas(kelas) = sigap.norm_kelas($3::text))
order by dicatat_pada asc
limit ${MAX_ROWS + 1}`;
const r = await sql.unsafe(q, [iso(a), iso(b), kelasFilter]);
rows = r.map((x: any) => def.select!.map((_e, i) => String(x["c" + i] ?? "")));
}
if (rows.length > MAX_ROWS) {
await audit(sql, user.name, user.id, "Export Data Gagal", detail(jenis, periode, scope, format, rows.length, "melebihi batas baris"));
return { status: "error", message: `Data terlalu banyak (lebih dari ${MAX_ROWS} baris, batas ${MAX_ROWS}). Persempit periode atau pilih satu kelas.` };
}
await audit(sql, user.name, user.id, rows.length ? "Export Data" : "Export Data Kosong",
detail(jenis, periode, scope, format, rows.length, rows.length ? "berhasil" : "tidak ada data"));
const now = await sql`select to_char(now() at time zone ${TZ}::text, 'DD/MM/YYYY HH24:MI') as t`;
return {
status: "success",
report: {
jenis, jenisLabel: def.label, judul: def.judul, sekolah: EXPORT_SEKOLAH,
columns: def.columns, rows, total: rows.length,
periodeLabel: periode, scopeLabel: scope, format, dibuatPada: now[0].t,
},
};
}
