// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
import { cleanText, isAdmin, isBk, isOsis, MAX_JENIS, MAX_KET, MSG_UNAUTH, MSG_NO_ACCESS } from "./data.ts";
const MAX_ROWS = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staf = (u: any) => isAdmin(u) || isBk(u);
const wali = (u: any) => String(u?.waliKelas ?? "").trim();
async function cariSiswa(sql: any, nisn: string) {
const r = await sql`select id, nisn, nama, kelas, kelas_norm from sigap.siswa where nisn = ${nisn}`;
return r.length ? r[0] : null;
}
export async function doAddUpacara(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (!(isOsis(s.user) || staf(s.user))) return { status: "error", message: "Tidak punya akses mencatat pelanggaran upacara." };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "Siswa belum dipilih." };
const jenis = cleanText(body?.jenis_pelanggaran, MAX_JENIS);
if (!jenis) return { status: "error", message: "Jenis pelanggaran belum diisi." };
const catatan = cleanText(body?.catatan, MAX_KET);
const siswa = await cariSiswa(sql, nisn);
if (!siswa) return { status: "error", message: "Siswa tidak ditemukan." };
const ins = await sql`
insert into sigap.pelanggaran_upacara (siswa_id, nisn, nama, kelas, jenis_pelanggaran, catatan, dicatat_oleh, dicatat_oleh_id)
values (${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${jenis}, ${catatan}, ${s.user.name}, ${s.user.id})
on conflict on constraint upacara_sekali_per_jenis_hari do nothing
returning id`;
if (!ins.length) return { status: "error", message: siswa.nama + ' sudah tercatat "' + jenis + '" hari ini.' };
return { status: "success" };
}
export async function doGetUpacara(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const w = wali(s.user);
const seluruh = staf(s.user) || isOsis(s.user);
if (!(seluruh || w)) return { status: "error", message: MSG_UNAUTH };
const rows = seluruh
? await sql`select * from sigap.pelanggaran_upacara order by dicatat_pada desc limit ${MAX_ROWS}`
: await sql`select * from sigap.pelanggaran_upacara where kelas_norm <> '' and kelas_norm = sigap.norm_kelas(${w}) order by dicatat_pada desc limit ${MAX_ROWS}`;
const osis = isOsis(s.user);
return {
status: "success",
upacara: rows.map((u: any) =>
osis
? { timestamp: u.dicatat_pada, name: u.nama, class: u.kelas, jenis_pelanggaran: u.jenis_pelanggaran, logged_by: u.dicatat_oleh }
: { timestamp: u.dicatat_pada, nisn: u.nisn, name: u.nama, class: u.kelas, jenis_pelanggaran: u.jenis_pelanggaran, catatan: u.catatan, logged_by: u.dicatat_oleh }
),
};
}
export async function doAddBimbingan(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (!staf(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "Siswa belum dipilih." };
const catatan = cleanText(body?.catatan, MAX_KET);
if (!catatan) return { status: "error", message: "Catatan belum diisi." };
const siswa = await cariSiswa(sql, nisn);
if (!siswa) return { status: "error", message: "Siswa tidak ditemukan." };
await sql`
insert into sigap.bimbingan_khusus (siswa_id, nisn, nama, kelas, catatan, dicatat_oleh, dicatat_oleh_id)
values (${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${catatan}, ${s.user.name}, ${s.user.id})`;
return { status: "success" };
}
export async function doGetBimbingan(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (!staf(s.user)) return { status: "error", message: MSG_UNAUTH };
const rows = await sql`select * from sigap.bimbingan_khusus order by dicatat_pada desc limit ${MAX_ROWS}`;
return {
status: "success",
bimbingan: rows.map((r: any) => ({ timestamp: r.dicatat_pada, nisn: r.nisn, name: r.nama, class: r.kelas, catatan: r.catatan, logged_by: r.dicatat_oleh })),
};
}
export async function doAjukanTindakLanjut(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "Siswa belum dipilih." };
const siswa = await cariSiswa(sql, nisn);
if (!siswa) return { status: "error", message: "Siswa tidak ditemukan." };
if (!staf(s.user)) {
const w = wali(s.user);
const ok = w ? (await sql`select (${siswa.kelas_norm}::text <> '' and ${siswa.kelas_norm}::text = sigap.norm_kelas(${w})) as ok`)[0].ok : false;
if (!ok) return { status: "error", message: "Hanya admin/BK atau wali kelas terkait yang bisa mengajukan tindak lanjut." };
}
const catatan = cleanText(body?.catatan, MAX_KET);
await sql`
insert into sigap.tindak_lanjut (siswa_id, nisn, nama, kelas, catatan, diajukan_oleh, diajukan_oleh_id)
values (${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${catatan}, ${s.user.name}, ${s.user.id})`;
await audit(sql, s.user.name, s.user.id, "Ajukan Tindak Lanjut", siswa.nama + " (" + siswa.nisn + ")");
return { status: "success" };
}
export async function doApproveTindakLanjut(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (!isAdmin(s.user)) return { status: "error", message: "Hanya admin yang bisa menyetujui tindak lanjut." };
const id = typeof body?.id === "string" ? body.id.trim() : "";
const MSG = "Data tindak lanjut tidak ditemukan.";
if (!UUID_RE.test(id)) return { status: "error", message: MSG };
const r = await sql`select id, nisn, status from sigap.tindak_lanjut where id = ${id}`;
if (!r.length) return { status: "error", message: MSG };
if (r[0].status !== "selesai") {
await sql`update sigap.tindak_lanjut set status = 'selesai', disetujui_oleh = ${s.user.name}, disetujui_oleh_id = ${s.user.id}, disetujui_pada = now() where id = ${id}`;
await audit(sql, s.user.name, s.user.id, "Setujui Tindak Lanjut", r[0].nisn);
}
return { status: "success" };
}
export async function doGetTindakLanjut(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
let rows: any[] = [];
if (staf(s.user)) {
rows = await sql`select * from sigap.tindak_lanjut order by dicatat_pada desc limit ${MAX_ROWS}`;
} else if (wali(s.user)) {
rows = await sql`select * from sigap.tindak_lanjut where kelas_norm <> '' and kelas_norm = sigap.norm_kelas(${wali(s.user)}) order by dicatat_pada desc limit ${MAX_ROWS}`;
}
return {
status: "success",
tindakLanjut: rows.map((t: any) => ({
id: t.id, timestamp: t.dicatat_pada, nisn: t.nisn, name: t.nama, class: t.kelas, catatan: t.catatan,
diajukanOleh: t.diajukan_oleh, status: t.status, disetujuiOleh: t.disetujui_oleh, tanggalDisetujui: t.disetujui_pada ?? "",
})),
};
}
