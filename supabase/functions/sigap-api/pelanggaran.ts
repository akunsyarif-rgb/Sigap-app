// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
import { cleanText, isAdmin, isBk, isOsis, MAX_JENIS, MAX_KET, MSG_NO_ACCESS, MSG_UNAUTH } from "./data.ts";
const MAX_ROWS = 20000;
export const KELOMPOK_MAX_SISWA = 60;
function pelOut(r: any) {
return {
id: r.id,
timestamp: r.dicatat_pada,
nisn: r.nisn,
name: r.nama,
class: r.kelas,
jenis_pelanggaran: r.jenis_pelanggaran,
sanksi: r.sanksi,
catatan: r.catatan,
logged_by: r.dicatat_oleh,
};
}
async function readScopedPel(sql: any, user: any, nisn?: string) {
const params: unknown[] = [];
const conds: string[] = [];
if (!(isAdmin(user) || isBk(user))) {
const wali = String(user.waliKelas ?? "").trim();
params.push(user.id, user.name);
const own = `(dicatat_oleh_id = $1::text or (dicatat_oleh_id is null and dicatat_oleh = $2::text and $2::text <> ''))`;
if (wali) {
params.push(wali);
conds.push(`((kelas_norm <> '' and kelas_norm = sigap.norm_kelas($3::text)) or ${own})`);
} else {
conds.push(own);
}
}
if (typeof nisn === "string" && nisn !== "") {
params.push(nisn);
conds.push(`nisn = $${params.length}::text`);
}
const where = conds.length ? " where " + conds.join(" and ") : "";
return await sql.unsafe(`select * from sigap.pelanggaran${where} order by dicatat_pada desc limit ${MAX_ROWS}`, params);
}
export async function doAddPelanggaran(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "Siswa belum dipilih." };
const jenis = cleanText(body?.jenis_pelanggaran, MAX_JENIS);
if (!jenis) return { status: "error", message: "Jenis pelanggaran belum diisi." };
const sanksi = cleanText(body?.sanksi, MAX_JENIS);
const catatan = cleanText(body?.catatan, MAX_KET);
const sw = await sql`select id, nisn, nama, kelas from sigap.siswa where nisn = ${nisn}`;
if (!sw.length) return { status: "error", message: "Siswa tidak ditemukan." };
const siswa = sw[0];
const ins = await sql`
insert into sigap.pelanggaran (siswa_id, nisn, nama, kelas, jenis_pelanggaran, sanksi, catatan, dicatat_oleh, dicatat_oleh_id)
values (${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${jenis}, ${sanksi}, ${catatan}, ${s.user.name}, ${s.user.id})
returning id, dicatat_pada`;
return { status: "success", id: ins[0].id, timestamp: ins[0].dicatat_pada };
}
export async function doAddPelanggaranKelompok(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const daftar = Array.isArray(body?.siswa) ? body.siswa : [];
if (!daftar.length) return { status: "error", message: "Pilih minimal satu siswa." };
if (daftar.length > KELOMPOK_MAX_SISWA) {
return { status: "error", message: "Siswa terlalu banyak (maksimal " + KELOMPOK_MAX_SISWA + " siswa per kejadian)." };
}
const items = daftar.map((it: any) => ({
nisn: cleanText(it?.nisn, 40),
jenis: cleanText(it?.jenis_pelanggaran, MAX_JENIS),
sanksi: cleanText(it?.sanksi, MAX_JENIS),
catatan: cleanText(it?.catatan, MAX_KET),
}));
if (items.some((it: any) => !it.jenis || !it.sanksi)) {
return { status: "error", message: "Jenis Pelanggaran dan Tindakan wajib diisi untuk setiap siswa." };
}
const seen = new Set<string>();
for (const it of items) {
if (!it.nisn || seen.has(it.nisn)) {
return { status: "error", message: "Ada siswa yang dipilih lebih dari sekali dalam satu kejadian." };
}
seen.add(it.nisn);
}
const nisns = items.map((it: any) => it.nisn);
const found = await sql`select nisn, nama, kelas, kelas_norm from sigap.siswa where nisn in (select jsonb_array_elements_text(${JSON.stringify(nisns)}::jsonb))`;
const byNisn = new Map(found.map((r: any) => [r.nisn, r]));
const hilang = nisns.filter((n: string) => !byNisn.has(n));
if (hilang.length) {
return { status: "error", message: "Ada siswa yang tidak ditemukan di data induk (NISN: " + hilang.slice(0, 5).join(", ") + ")." };
}
const acuan = (byNisn.get(nisns[0]) as any).kelas_norm;
if (nisns.some((n: string) => (byNisn.get(n) as any).kelas_norm !== acuan)) {
return {
status: "error",
message: "Fitur ini hanya untuk siswa satu kelas yang sama. Untuk kejadian yang melibatkan siswa dari kelas berbeda, catat satu per satu melalui menu Individual.",
};
}
const ins = await sql`
insert into sigap.pelanggaran (siswa_id, nisn, nama, kelas, jenis_pelanggaran, sanksi, catatan, dicatat_oleh, dicatat_oleh_id)
select sw.id, sw.nisn, sw.nama, sw.kelas, x.jenis, x.sanksi, x.catatan, ${s.user.name}, ${s.user.id}
from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as x(nisn text, jenis text, sanksi text, catatan text)
join sigap.siswa sw on sw.nisn = x.nisn
returning id`;
const kelas = (byNisn.get(nisns[0]) as any).kelas;
await audit(sql, s.user.name, s.user.id, "Pelanggaran Kelompok",
"kelas=" + kelas + " | jumlah=" + ins.length + " | siswa=" + nisns.map((n: string) => (byNisn.get(n) as any).nama).join(", "));
return { status: "success", jumlahSiswa: ins.length };
}
export async function doGetPelanggaran(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const rows = await readScopedPel(sql, s.user);
return { status: "success", pelanggaran: rows.map(pelOut) };
}
export async function doGetPelanggaranCount(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "success", count: 0 };
const rows = await readScopedPel(sql, s.user, nisn);
return { status: "success", count: rows.length };
}
