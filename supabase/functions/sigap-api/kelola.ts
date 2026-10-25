// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END, randomHex, sha256Hex, verifyPassword, MAX_PW_LEN } from "./logic.ts";
import { cleanText, isAdmin, isBk, isOsis, MSG_NO_ACCESS, MSG_UNAUTH } from "./data.ts";
export const ROLE_VALID = ["guru", "bk_kesiswaan", "osis", "admin"];
export const MIN_PW = 6;
const MSG_ID_HILANG = "ID tidak ditemukan";
const rapi = (v: unknown, max: number) => cleanText(typeof v === "string" ? v.replace(/\s+/g, " ") : "", max);
const wali = (u: any) => String(u?.waliKelas ?? "").trim();
const staf = (u: any) => isAdmin(u) || isBk(u);
async function buatHash(pw: string) {
const salt = randomHex(16);
return { salt, hash: await sha256Hex(salt + ":" + pw.trim()) };
}
function pwError(pw: unknown): string | null {
if (typeof pw !== "string" || pw.trim().length < MIN_PW) return "Password minimal " + MIN_PW + " karakter.";
if (pw.length > MAX_PW_LEN) return "Password terlalu panjang.";
return null;
}
async function adminSession(sql: any, body: any, pesan: string) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { err: MSG_SESSION_END };
if (!isAdmin(s.user)) return { err: pesan };
return { s };
}
export async function doGetLoginUsers(sql: any, _body: any) {
const r = await sql`
select id, nama from sigap.guru
where lower(btrim(status)) <> 'nonaktif' and btrim(id) <> '' and btrim(nama) <> ''
order by lower(nama), nama`;
return { status: "success", users: r.map((x: any) => ({ id: x.id, name: x.nama })) };
}
export async function doGetStudents(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const r = await sql`select nisn, nama, kelas, status from sigap.siswa order by lower(nama), nisn`;
return {
status: "success",
students: r.map((x: any) => {
const o: any = { nisn: x.nisn, name: x.nama, class: x.kelas };
if (x.status !== "aktif") o.status = x.status;
return o;
}),
};
}
export async function doGetTeachers(sql: any, body: any) {
const a = await adminSession(sql, body, MSG_UNAUTH);
if (a.err) return { status: "error", message: a.err };
const r = await sql`select id, nama, role, jabatan, status, kelas_wali from sigap.guru order by lower(nama), nama`;
return {
status: "success",
teachers: r.map((t: any) => ({
id: t.id, name: t.nama, role: t.role, jabatan: t.jabatan,
status: String(t.status).toLowerCase().trim() === "nonaktif" ? "nonaktif" : "aktif", kelasWali: t.kelas_wali,
})),
};
}
export async function doGetWaliKelasMap(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const r = await sql`select kelas_wali, nama, id from sigap.guru where btrim(kelas_wali) <> '' order by kelas_wali, nama`;
return { status: "success", waliKelasMap: r.map((x: any) => ({ class: x.kelas_wali, waliKelasName: x.nama, waliKelasId: x.id })) };
}
export async function doGetAuditLog(sql: any, body: any) {
const a = await adminSession(sql, body, MSG_UNAUTH);
if (a.err) return { status: "error", message: a.err };
const r = await sql`select waktu, nama, guru_id, aksi, detail from sigap.audit_log order by id desc limit 300`;
return {
status: "success",
auditLog: r.map((x: any) => ({ timestamp: x.waktu, name: x.nama, id: x.guru_id ?? "", action: x.aksi, detail: x.detail })),
};
}
export async function doGetTodayData(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const u = s.user;
const w = wali(u);
const HARI = "tanggal = (now() at time zone 'Asia/Makassar')::date";
const KELAS = "(kelas_norm <> '' and kelas_norm = sigap.norm_kelas($1::text))";
const late = await sql.unsafe(`select * from sigap.terlambat where ${HARI} order by dicatat_pada desc limit 20000`);
const surat = await sql.unsafe(`select * from sigap.surat_masuk where ${HARI} order by dicatat_pada desc limit 20000`);
let pel: any[];
if (staf(u)) {
pel = await sql.unsafe(`select * from sigap.pelanggaran where ${HARI} order by dicatat_pada desc limit 20000`);
} else {
const o = w ? 2 : 1; // indeks parameter pertama untuk "own"
const own = `(dicatat_oleh_id = $${o}::text or (dicatat_oleh_id is null and dicatat_oleh = $${o + 1}::text and $${o + 1}::text <> ''))`;
pel = await sql.unsafe(
`select * from sigap.pelanggaran where ${HARI} and (${w ? KELAS + " or " : ""}${own}) order by dicatat_pada desc limit 20000`,
w ? [w, u.id, u.name] : [u.id, u.name],
);
}
const cutoff = `least(date_trunc('week', (now() at time zone 'Asia/Makassar'))::date, date_trunc('month', (now() at time zone 'Asia/Makassar'))::date)`;
const banner = staf(u)
? await sql.unsafe(`select * from sigap.terlambat where tanggal >= ${cutoff} order by dicatat_pada asc limit 20000`)
: await sql.unsafe(
`select * from sigap.terlambat where tanggal >= ${cutoff} and (${HARI}${w ? " or " + KELAS : ""}) order by dicatat_pada asc limit 20000`,
w ? [w] : [],
);
const lateOut = (r: any) => ({ timestamp: r.dicatat_pada, nisn: r.nisn, name: r.nama, class: r.kelas, type: r.alasan, logged_by: r.dicatat_oleh });
return {
status: "success",
todayLate: late.map(lateOut),
todaySurat: surat.map((r: any) => ({
timestamp: r.dicatat_pada, nisn: r.nisn, name: r.nama, class: r.kelas, jenis: r.jenis,
keterangan: r.keterangan, foto_url: r.foto_url ?? "", logged_by: r.dicatat_oleh,
})),
todayPelanggaran: pel.map((r: any) => ({
timestamp: r.dicatat_pada, nisn: r.nisn, name: r.nama, class: r.kelas, jenis_pelanggaran: r.jenis_pelanggaran,
sanksi: r.sanksi, catatan: r.catatan, logged_by: r.dicatat_oleh,
})),
lateForBanner: banner.map(lateOut),
};
}
export async function doAddTeacher(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa menambah guru");
if (a.err) return { status: "error", message: a.err };
const s = a.s!;
const id = cleanText(body?.newId, 40);
const nama = rapi(body?.newName, 100);
const role = typeof body?.newRole === "string" ? body.newRole.trim().toLowerCase() : "";
if (!id) return { status: "error", message: "ID guru wajib diisi." };
if (!nama) return { status: "error", message: "Nama tidak boleh kosong" };
if (!ROLE_VALID.includes(role)) return { status: "error", message: "Role tidak dikenali: " + cleanText(body?.newRole, 30) };
const pe = pwError(body?.newPassword);
if (pe) return { status: "error", message: pe };
const jabatan = rapi(body?.newJabatan, 100);
const { salt, hash } = await buatHash(body.newPassword);
const ins = await sql`
insert into sigap.guru (id, nama, password_hash, salt, role, jabatan)
values (${id}, ${nama}, ${hash}, ${salt}, ${role}, ${jabatan})
on conflict (id) do nothing returning id`;
if (!ins.length) return { status: "error", message: "ID sudah dipakai, gunakan ID lain" };
await audit(sql, s.user.name, s.user.id, "Tambah Guru", nama + " (" + id + ", role: " + role + ")");
return { status: "success" };
}
export async function doUpdatePassword(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa mengubah password");
if (a.err) return { status: "error", message: a.err };
const s = a.s!;
const id = cleanText(body?.targetId, 40);
const pe = pwError(body?.newPassword);
if (pe) return { status: "error", message: pe };
const { salt, hash } = await buatHash(body.newPassword);
const up = await sql`
update sigap.guru set password_hash = ${hash}, salt = ${salt}, password_changed_at = now(), updated_at = now()
where id = ${id} returning nama`;
if (!up.length) return { status: "error", message: MSG_ID_HILANG };
await audit(sql, s.user.name, s.user.id, "Reset Password", up[0].nama + " (" + id + ")");
return { status: "success" };
}
export async function doChangeMyPassword(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const r = await sql`select password_hash, salt from sigap.guru where id = ${s.user.id}`;
if (!r.length) return { status: "error", message: "Akun tidak ditemukan." };
const lama = typeof body?.oldPassword === "string" ? body.oldPassword : "";
if (!lama || lama.length > MAX_PW_LEN) return { status: "error", message: "Password lama salah." };
const chk = await verifyPassword(lama, String(r[0].password_hash), String(r[0].salt ?? ""));
if (!chk) return { status: "error", message: "Password lama salah." };
const pe = pwError(body?.newPassword);
if (pe) return { status: "error", message: pe.replace("Password minimal", "Password baru minimal") };
const sama = await verifyPassword(body.newPassword, String(r[0].password_hash), String(r[0].salt ?? ""));
if (sama) return { status: "error", message: "Password baru tidak boleh sama dengan password lama." };
const { salt, hash } = await buatHash(body.newPassword);
await sql`update sigap.guru set password_hash = ${hash}, salt = ${salt}, password_changed_at = now(), updated_at = now() where id = ${s.user.id}`;
await audit(sql, s.user.name, s.user.id, "Ganti Password Sendiri", "");
await sql`delete from sigap.sesi where guru_id = ${s.user.id}`;
return { status: "success" };
}
export async function doUpdateJabatan(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa mengubah jabatan");
if (a.err) return { status: "error", message: a.err };
const id = cleanText(body?.targetId, 40);
const jab = rapi(body?.newJabatan, 100);
const up = await sql`update sigap.guru set jabatan = ${jab}, updated_at = now() where id = ${id} returning id`;
if (!up.length) return { status: "error", message: MSG_ID_HILANG };
await audit(sql, a.s!.user.name, a.s!.user.id, "Ubah Jabatan", id + ' -> "' + (jab || "(kosong)") + '"');
return { status: "success" };
}
export async function doUpdateRole(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa mengubah role");
if (a.err) return { status: "error", message: a.err };
const id = cleanText(body?.targetId, 40);
const role = typeof body?.newRole === "string" ? body.newRole.trim().toLowerCase() : "";
if (!ROLE_VALID.includes(role)) return { status: "error", message: "Role tidak dikenali: " + cleanText(body?.newRole, 30) };
if (id === a.s!.user.id && role !== "admin") {
return { status: "error", message: "Tidak bisa menurunkan role akun sendiri dari admin." };
}
const up = await sql`update sigap.guru set role = ${role}, updated_at = now() where id = ${id} returning nama`;
if (!up.length) return { status: "error", message: MSG_ID_HILANG };
await audit(sql, a.s!.user.name, a.s!.user.id, "Ubah Role", up[0].nama + " (" + id + ") -> " + role);
return { status: "success" };
}
export async function doUpdateWaliKelas(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa mengubah kelas wali");
if (a.err) return { status: "error", message: a.err };
const id = cleanText(body?.targetId, 40);
const kelas = rapi(body?.newKelasWali, 40);
const up = await sql`update sigap.guru set kelas_wali = ${kelas}, updated_at = now() where id = ${id} returning nama`;
if (!up.length) return { status: "error", message: MSG_ID_HILANG };
await audit(sql, a.s!.user.name, a.s!.user.id, "Ubah Kelas Wali", up[0].nama + " (" + id + ') -> "' + (kelas || "(kosong)") + '"');
return { status: "success" };
}
export async function doUpdateTeacherName(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa mengubah nama guru");
if (a.err) return { status: "error", message: a.err };
const nama = rapi(body?.newName, 100);
if (!nama) return { status: "error", message: "Nama tidak boleh kosong" };
const id = cleanText(body?.targetId, 40);
const r = await sql`select nama from sigap.guru where id = ${id}`;
if (!r.length) return { status: "error", message: MSG_ID_HILANG };
await sql`update sigap.guru set nama = ${nama}, updated_at = now() where id = ${id}`;
await audit(sql, a.s!.user.name, a.s!.user.id, "Ubah Nama Guru", r[0].nama + " -> " + nama + " (" + id + ")");
return { status: "success" };
}
export async function doDeleteTeacher(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa menghapus akun guru");
if (a.err) return { status: "error", message: a.err };
const id = cleanText(body?.targetId, 40);
if (id === a.s!.user.id) return { status: "error", message: "Tidak bisa menghapus akun sendiri." };
const r = await sql`select nama, kelas_wali from sigap.guru where id = ${id}`;
if (!r.length) return { status: "error", message: MSG_ID_HILANG };
if (String(r[0].kelas_wali).trim()) {
return { status: "error", message: "Guru ini masih tercatat sebagai wali kelas " + r[0].kelas_wali + '. Lepas status wali kelasnya dulu lewat tombol "Wali Kelas" sebelum menghapus.' };
}
const del = await sql`
with j as (delete from sigap.jadwal_piket where guru_id = ${id}),
d as (delete from sigap.guru where id = ${id} returning nama)
select nama from d`;
if (!del.length) return { status: "error", message: MSG_ID_HILANG };
await audit(sql, a.s!.user.name, a.s!.user.id, "Hapus Guru", r[0].nama + " (" + id + ")");
return { status: "success" };
}
export async function doToggleTeacherStatus(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa mengubah status akun");
if (a.err) return { status: "error", message: a.err };
const id = cleanText(body?.targetId, 40);
if (id === a.s!.user.id) return { status: "error", message: "Tidak bisa menonaktifkan akun sendiri." };
const up = await sql`
update sigap.guru set status = case when lower(btrim(status)) = 'nonaktif' then 'aktif' else 'nonaktif' end, updated_at = now()
where id = ${id} returning nama, status`;
if (!up.length) return { status: "error", message: MSG_ID_HILANG };
await audit(sql, a.s!.user.name, a.s!.user.id, up[0].status === "nonaktif" ? "Nonaktifkan Akun" : "Aktifkan Akun", up[0].nama + " (" + id + ")");
return { status: "success", newStatus: up[0].status };
}
export async function doAddStudent(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const nama = rapi(body?.name, 120);
const kelas = rapi(body?.class_name, 40);
const nisnIn = cleanText(body?.nisn, 40);
if (!nama) return { status: "error", message: "Nama lengkap wajib diisi." };
if (!kelas) return { status: "error", message: "Kelas wajib diisi." };
if (nisnIn) {
const d = await sql`select nama, kelas from sigap.siswa where nisn = ${nisnIn}`;
if (d.length) return { status: "error", message: "NISN sudah dipakai oleh " + d[0].nama + " (" + d[0].kelas + ")." };
}
const k = await sql`
select nama, kelas, nisn from sigap.siswa
where lower(nama) = lower(${nama}) and kelas_norm <> '' and kelas_norm = sigap.norm_kelas(${kelas}::text) limit 1`;
if (k.length) {
return { status: "error", message: "Siswa dengan nama & kelas yang sama sudah ada: " + k[0].nama + " (" + k[0].kelas + ", NISN: " + (k[0].nisn || "(belum diisi)") + ")." };
}
const status = isAdmin(s.user) ? "aktif" : "perlu_verifikasi";
let row: any = null;
for (let i = 0; i < 4 && !row; i++) {
const r = await sql`
insert into sigap.siswa (nisn, nama, kelas, status, ditambah_oleh, waktu_tambah)
select coalesce(nullif(${nisnIn}::text, ''), 'TMP-' || lpad((coalesce(x.m, 0) + 1)::text, 3, '0')),
${nama}, ${kelas}, ${status}, ${s.user.name}, now()
from (select max((substring(nisn from '^TMP-([0-9]+)$'))::int) as m from sigap.siswa where nisn ~ '^TMP-[0-9]+$') x
on conflict (nisn) do nothing
returning nisn, nama, kelas`;
if (r.length) row = r[0];
else if (nisnIn) return { status: "error", message: "NISN sudah dipakai oleh siswa lain." };
}
if (!row) return { status: "error", message: "Gagal membuat NISN sementara, coba lagi." };
await audit(sql, s.user.name, s.user.id, "Tambah Siswa", nama + " (" + kelas + ", NISN: " + row.nisn + ", status: " + status + ")");
const out: any = { nisn: row.nisn, name: row.nama, class: row.kelas };
if (status !== "aktif") out.status = status;
return { status: "success", student: out };
}
const TABEL_LOG = ["terlambat", "surat_masuk", "pelanggaran", "pelanggaran_upacara", "bimbingan_khusus", "izin_keluar", "tindak_lanjut"];
export async function doVerifyStudent(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa memverifikasi siswa.");
if (a.err) return { status: "error", message: a.err };
const lama = cleanText(body?.nisn, 40);
if (!lama) return { status: "error", message: "NISN siswa wajib dikirim." };
const f = await sql`select id, nisn, nama, kelas from sigap.siswa where nisn = ${lama}`;
if (!f.length) return { status: "error", message: "Siswa tidak ditemukan (mungkin sudah diubah/dihapus)." };
const sw = f[0];
const nama = body?.newName !== undefined ? rapi(body.newName, 120) : sw.nama;
const kelas = body?.newClass !== undefined ? rapi(body.newClass, 40) : sw.kelas;
const baruIn = body?.newNisn !== undefined ? cleanText(body.newNisn, 40) : "";
const baru = baruIn || lama;
if (!nama) return { status: "error", message: "Nama lengkap wajib diisi." };
if (!kelas) return { status: "error", message: "Kelas wajib diisi." };
const berubah = baru !== lama;
if (berubah) {
const d = await sql`select nama from sigap.siswa where nisn = ${baru} and id <> ${sw.id}`;
if (d.length) return { status: "error", message: "NISN baru sudah dipakai oleh " + d[0].nama + "." };
}
try {
if (berubah) {
await sql`
with s as (update sigap.siswa set nisn = ${baru}, nama = ${nama}, kelas = ${kelas}, status = 'aktif', nisn_lama = ${lama} where id = ${sw.id} returning id),
t1 as (update sigap.terlambat set nisn = ${baru} where siswa_id = ${sw.id}),
t2 as (update sigap.surat_masuk set nisn = ${baru} where siswa_id = ${sw.id}),
t3 as (update sigap.pelanggaran set nisn = ${baru} where siswa_id = ${sw.id}),
t4 as (update sigap.pelanggaran_upacara set nisn = ${baru} where siswa_id = ${sw.id}),
t5 as (update sigap.bimbingan_khusus set nisn = ${baru} where siswa_id = ${sw.id}),
t6 as (update sigap.izin_keluar set nisn = ${baru} where siswa_id = ${sw.id}),
t7 as (update sigap.tindak_lanjut set nisn = ${baru} where siswa_id = ${sw.id})
select id from s`;
} else {
await sql`update sigap.siswa set nama = ${nama}, kelas = ${kelas}, status = 'aktif' where id = ${sw.id}`;
}
} catch (e: any) {
if (e?.code === "23505") return { status: "error", message: "NISN baru baru saja dipakai pengguna lain. Muat ulang lalu coba lagi." };
throw e;
}
await audit(sql, a.s!.user.name, a.s!.user.id, "Verifikasi Siswa", nama + " (" + kelas + ") | nisn_lama=" + lama + " | nisn_baru=" + baru);
return { status: "success", student: { nisn: baru, name: nama, class: kelas } };
}
export async function doDeleteStudent(sql: any, body: any) {
const a = await adminSession(sql, body, "Hanya admin yang bisa menghapus siswa.");
if (a.err) return { status: "error", message: a.err };
const nisn = cleanText(body?.nisn, 40);
if (!nisn) return { status: "error", message: "NISN siswa wajib dikirim." };
const f = await sql`select id, nama, kelas, status from sigap.siswa where nisn = ${nisn}`;
if (!f.length) return { status: "error", message: "Siswa tidak ditemukan (mungkin sudah dihapus)." };
const sw = f[0];
if (sw.status !== "perlu_verifikasi") {
return { status: "error", message: 'Hanya siswa berstatus "perlu verifikasi" yang bisa dihapus. Gunakan Edit untuk siswa aktif.' };
}
for (const t of TABEL_LOG) {
const ada = await sql.unsafe(`select 1 from sigap.${t} where siswa_id = $1::uuid or nisn = $2::text limit 1`, [sw.id, nisn]);
if (ada.length) return { status: "error", message: "Siswa ini sudah punya catatan di " + t + ". Gunakan Edit, bukan Hapus." };
}
try {
await sql`delete from sigap.siswa where id = ${sw.id}`;
} catch (e: any) {
if (e?.code === "23503") return { status: "error", message: "Siswa ini baru saja mendapat catatan. Gunakan Edit, bukan Hapus." };
throw e;
}
await audit(sql, a.s!.user.name, a.s!.user.id, "Hapus Siswa", sw.nama + " (" + sw.kelas + ", NISN: " + nisn + ")");
return { status: "success" };
}
