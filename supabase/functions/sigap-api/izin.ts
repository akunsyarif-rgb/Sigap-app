// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
import { cleanText, isAdmin, isBk, isOsis, MSG_NO_ACCESS, MSG_UNAUTH } from "./data.ts";
const MAX_ROWS = 20000;
export const MAX_KEPERLUAN = 200;
export const MAX_ALASAN = 300;
export const EDIT_WINDOW_SECONDS = 5 * 60;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JAM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ST_MENUNGGU = "Menunggu Verifikasi";
export const ST_DI_LUAR = "Sedang di Luar";
export const ST_SELESAI = "Selesai";
export const ST_PULANG = "Pulang";
export const ST_KEMBALI = "Kembali"; // legacy
export const TERBUKA = [ST_MENUNGGU, ST_DI_LUAR];
export const TERBUKA_SQL = "('Menunggu Verifikasi','Sedang di Luar')";
const NAMA_HARI_SQL = "array['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu']";
export const hariDari = (expr: string) => `(${NAMA_HARI_SQL})[extract(dow from (${expr} at time zone 'Asia/Makassar'))::int + 1]`;
export const staf = (u: any) => isAdmin(u) || isBk(u);
export const wali = (u: any) => String(u?.waliKelas ?? "").trim();
export type Kapasitas = "guru_piket" | "bk_kesiswaan" | null;
export function kapasitasLabel(k: Kapasitas) {
return k === "guru_piket" ? "Guru Piket" : k === "bk_kesiswaan" ? "BK/Kesiswaan" : "";
}
export async function kapasitasVerifikasi(sql: any, user: any): Promise<Kapasitas> {
if (!user || isOsis(user)) return null;
const r = await sql.unsafe(
`select exists(select 1 from sigap.jadwal_piket where hari = ${hariDari("now()")} and guru_id = $1::text) as ok`,
[user.id],
);
if (r[0].ok) return "guru_piket";
if (staf(user)) return "bk_kesiswaan";
return null;
}
function detail(r: any, tambahan = "") {
const d = `${r.nama} (${r.nisn}) | kelas=${r.kelas} | tujuan=${r.tujuan} | jalur=${r.jalur}`;
return tambahan ? d + " | " + tambahan : d;
}
function izinOut(r: any) {
return {
timestamp: r.dicatat_pada,
nisn: r.nisn,
name: r.nama,
class: r.kelas,
id: r.id,
keperluan: r.keperluan,
tujuan: r.tujuan,
status: r.status,
jalur: r.jalur,
alasan_khusus: r.alasan_khusus,
disetujui_oleh: r.disetujui_oleh,
disetujui_oleh_id: r.disetujui_oleh_id ?? "",
waktu_persetujuan: r.waktu_persetujuan ?? "",
diverifikasi_oleh: r.diverifikasi_oleh,
diverifikasi_oleh_id: r.diverifikasi_oleh_id ?? "",
waktu_verifikasi: r.waktu_verifikasi ?? "",
waktu_keluar: r.waktu_keluar ?? "",
waktu_kembali: r.waktu_kembali ?? "",
dicatat_kembali_oleh: r.dicatat_kembali_oleh,
dicatat_kembali_oleh_id: r.dicatat_kembali_oleh_id ?? "",
kelompok_id: r.kelompok_id ?? "",
nomor_surat: r.nomor_surat,
waktu_print: r.waktu_print ?? "",
status_print: r.status_print,
jam_perkiraan_kembali: r.jam_perkiraan_kembali,
logged_by: r.disetujui_oleh,
kegiatan: r.kegiatan ?? "",
diverifikasi_kapasitas: r.ver_kap ?? "",
dicatat_kembali_kapasitas: r.kem_kap ?? "",
};
}
export function tolakTransisi(status: string, aksi: "verifikasi" | "pulang" | "kembali") {
if (aksi === "verifikasi") {
if (status === ST_DI_LUAR) return "Izin ini sudah diverifikasi — siswa sudah tercatat keluar.";
return "Izin ini sudah tidak menunggu verifikasi (status: " + status + ").";
}
if (aksi === "pulang") {
if (status === ST_MENUNGGU) return "Izin ini belum diverifikasi Guru Piket, jadi siswa belum tercatat keluar.";
if (status === ST_KEMBALI) return "Siswa ini sudah tercatat kembali ke sekolah.";
if (status === ST_PULANG) return "Siswa ini sudah tercatat pulang.";
return "Transaksi ini sudah selesai — tidak bisa diubah lagi.";
}
if (status === ST_MENUNGGU) return "Izin ini belum diverifikasi Guru Piket, jadi siswa belum tercatat keluar.";
if (status === ST_PULANG) return "Siswa ini izin PULANG (tidak kembali) — tidak bisa ditandai kembali.";
if (status === ST_KEMBALI) return "Siswa ini sudah ditandai kembali.";
return "Transaksi ini sudah selesai — tidak bisa ditandai kembali.";
}
export const MSG_IZIN_HILANG = "Data izin tidak ditemukan (mungkin sudah diproses pengguna lain).";
async function ambilIzin(sql: any, id: unknown) {
const s = typeof id === "string" ? id.trim() : "";
if (!UUID_RE.test(s)) return null;
const r = await sql`select * from sigap.izin_keluar where id = ${s}`;
return r.length ? r[0] : null;
}
export async function doAddIzin(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const tujuan = String(body?.tujuan ?? "").trim().toLowerCase();
if (tujuan !== "kembali" && tujuan !== "pulang") {
return { status: "error", message: "Tujuan izin harus dipilih: kembali ke sekolah atau pulang." };
}
const keperluan = cleanText(body?.keperluan, MAX_KEPERLUAN);
if (!keperluan) return { status: "error", message: "Keperluan wajib diisi." };
const nisn = cleanText(body?.nisn, 40);
const sw = nisn ? await sql`select id, nisn, nama, kelas, kelas_norm from sigap.siswa where nisn = ${nisn}` : [];
if (!sw.length) return { status: "error", message: "Siswa tidak ditemukan di data induk (NISN harus terisi)." };
const siswa = sw[0];
const w = wali(s.user);
const konteksWali = w ? (await sql`select (${siswa.kelas_norm}::text <> '' and ${siswa.kelas_norm}::text = sigap.norm_kelas(${w})) as ok`)[0].ok : false;
const konteks = konteksWali ? "wali_kelas" : "guru_mapel";
const khusus = String(body?.jalur ?? "").trim().toLowerCase() === "khusus";
let alasan = cleanText(body?.alasan_khusus, MAX_ALASAN);
let kap: Kapasitas = null;
if (khusus) {
kap = await kapasitasVerifikasi(sql, s.user);
if (!kap) return { status: "error", message: "Izin Khusus hanya bisa dibuat Guru Piket yang bertugas hari ini (atau BK/Admin)." };
if (!alasan) return { status: "error", message: "Alasan pengecualian wajib diisi untuk Izin Khusus." };
} else {
alasan = "";
}
const statusAwal = khusus ? (tujuan === "pulang" ? ST_PULANG : ST_DI_LUAR) : ST_MENUNGGU;
const ins = await sql`
insert into sigap.izin_keluar
(siswa_id, nisn, nama, kelas, keperluan, tujuan, status, jalur, alasan_khusus,
disetujui_oleh, disetujui_oleh_id, waktu_persetujuan,
diverifikasi_oleh, diverifikasi_oleh_id, waktu_verifikasi, waktu_keluar)
values
(${siswa.id}, ${siswa.nisn}, ${siswa.nama}, ${siswa.kelas}, ${keperluan}, ${tujuan}, ${statusAwal},
${khusus ? "khusus" : "normal"}, ${alasan},
${s.user.name}, ${s.user.id}, now(),
${khusus ? s.user.name : ""}, ${khusus ? s.user.id : null},
case when ${khusus}::boolean then now() end, case when ${khusus}::boolean then now() end)
on conflict (nisn) where status in ('Menunggu Verifikasi','Sedang di Luar') do nothing
returning *`;
if (!ins.length) {
const ada = await sql`select status from sigap.izin_keluar where nisn = ${siswa.nisn} and status in ('Menunggu Verifikasi','Sedang di Luar') limit 1`;
const st = ada.length ? ada[0].status : ST_MENUNGGU;
return {
status: "error",
message: st === ST_DI_LUAR
? siswa.nama + " tercatat masih di luar sekolah — tandai kembali dulu sebelum membuat izin baru."
: siswa.nama + " sudah punya izin yang menunggu verifikasi Guru Piket.",
};
}
const row = ins[0];
await audit(sql, s.user.name, s.user.id, khusus ? "Izin Keluar Khusus" : "Persetujuan Izin Keluar",
detail(row, (khusus ? "alasan pengecualian=" + alasan : "keperluan=" + keperluan + " | konteks=" + (konteksWali ? "Wali Kelas" : "Guru Mapel")) + " | id=" + row.id));
return { status: "success", id: row.id, izinStatus: statusAwal, konteks };
}
export async function doVerifikasiIzin(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const kap = await kapasitasVerifikasi(sql, s.user);
if (!kap) return { status: "error", message: "Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa memverifikasi." };
const izin = await ambilIzin(sql, body?.id);
if (!izin) return { status: "error", message: MSG_IZIN_HILANG };
if (izin.status !== ST_MENUNGGU) return { status: "error", message: tolakTransisi(izin.status, "verifikasi") };
let jam = cleanText(body?.jam_perkiraan_kembali, 5);
if (izin.tujuan === "kembali") {
if (!JAM_RE.test(jam)) return { status: "error", message: "Jam perkiraan kembali wajib diisi untuk siswa yang akan kembali ke sekolah." };
} else {
jam = "";
}
const baru = izin.tujuan === "pulang" ? ST_PULANG : ST_DI_LUAR;
const up = await sql`
update sigap.izin_keluar set status = ${baru}, diverifikasi_oleh = ${s.user.name}, diverifikasi_oleh_id = ${s.user.id},
waktu_verifikasi = now(), waktu_keluar = now(), jam_perkiraan_kembali = ${jam}
where id = ${izin.id} and status = ${ST_MENUNGGU}
returning id`;
if (!up.length) {
const cur = await ambilIzin(sql, izin.id);
return { status: "error", message: cur ? tolakTransisi(cur.status, "verifikasi") : MSG_IZIN_HILANG };
}
await audit(sql, s.user.name, s.user.id, "Verifikasi Izin Keluar",
detail(izin, "status=" + baru + " | kapasitas=" + kapasitasLabel(kap) + (jam ? " | jam_perkiraan_kembali=" + jam : "")));
return { status: "success", izinStatus: baru };
}
async function tandaiAkhir(sql: any, body: any, aksi: "kembali" | "pulang") {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const kap = await kapasitasVerifikasi(sql, s.user);
if (!kap) {
return {
status: "error",
message: aksi === "kembali"
? "Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menandai siswa kembali."
: "Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menandai siswa pulang.",
};
}
const izin = await ambilIzin(sql, body?.id);
if (!izin) return { status: "error", message: MSG_IZIN_HILANG };
if (izin.status !== ST_DI_LUAR) return { status: "error", message: tolakTransisi(izin.status, aksi) };
const baru = aksi === "kembali" ? ST_SELESAI : ST_PULANG;
const up = aksi === "kembali"
? await sql`update sigap.izin_keluar set status = ${baru}, waktu_kembali = now(), dicatat_kembali_oleh = ${s.user.name}, dicatat_kembali_oleh_id = ${s.user.id}
where id = ${izin.id} and status = ${ST_DI_LUAR} returning id`
: await sql`update sigap.izin_keluar set status = ${baru}
where id = ${izin.id} and status = ${ST_DI_LUAR} returning id`;
if (!up.length) {
const cur = await ambilIzin(sql, izin.id);
return { status: "error", message: cur ? tolakTransisi(cur.status, aksi) : MSG_IZIN_HILANG };
}
await audit(sql, s.user.name, s.user.id,
aksi === "kembali" ? "Tandai Kembali Izin Keluar" : "Tandai Pulang Izin Keluar",
detail(izin, "status=" + baru + (aksi === "pulang" ? " (tidak kembali ke sekolah)" : "") + " | kapasitas=" + kapasitasLabel(kap)));
return { status: "success", izinStatus: baru };
}
export const doTandaiKembaliIzin = (sql: any, body: any) => tandaiAkhir(sql, body, "kembali");
export const doTandaiPulangIzin = (sql: any, body: any) => tandaiAkhir(sql, body, "pulang");
export async function doDeleteIzin(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const MSG_HILANG = "Transaksi tidak ditemukan (mungkin sudah dihapus pengguna lain).";
const idStr = typeof body?.id === "string" ? body.id.trim() : "";
if (!UUID_RE.test(idStr)) return { status: "error", message: MSG_HILANG };
const r = await sql`select *, extract(epoch from (clock_timestamp() - dicatat_pada)) as umur_detik from sigap.izin_keluar where id = ${idStr}`;
if (!r.length) return { status: "error", message: MSG_HILANG };
const izin = r[0];
const kap = await kapasitasVerifikasi(sql, s.user);
if (!isAdmin(s.user)) {
if (!kap) return { status: "error", message: "Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menghapus izin keluar." };
if (!TERBUKA.includes(String(izin.status).trim())) return { status: "error", message: "Transaksi ini sudah selesai — hanya admin yang bisa menghapusnya." };
if (Number(izin.umur_detik) > EDIT_WINDOW_SECONDS) return { status: "error", message: "Sudah lewat 5 menit sejak dicatat — tidak bisa dihapus lagi." };
}
await sql`delete from sigap.izin_keluar where id = ${izin.id}`;
if (izin.kelompok_id) {
await sql`delete from sigap.izin_kelompok k where k.id = ${izin.kelompok_id}
and not exists (select 1 from sigap.izin_keluar i where i.kelompok_id = k.id)`;
}
await audit(sql, s.user.name, s.user.id, "Hapus Izin Keluar", detail(izin, "status=" + izin.status + " | kapasitas=" + kapasitasLabel(kap)));
return { status: "success" };
}
export async function doGetIzin(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const params: unknown[] = [];
let where = "";
if (!staf(s.user)) {
const w = wali(s.user);
const hariIniRow = `(i.dicatat_pada at time zone 'Asia/Makassar')::date = (now() at time zone 'Asia/Makassar')::date`;
if (w) {
params.push(w);
where = `where (i.status in ${TERBUKA_SQL} or ${hariIniRow} or (i.kelas_norm <> '' and i.kelas_norm = sigap.norm_kelas($1::text)))`;
} else {
where = `where (i.status in ${TERBUKA_SQL} or ${hariIniRow})`;
}
}
const kapKolom = (idCol: string, waktuCol: string) =>
`case when i.${idCol} is null or i.${waktuCol} is null then ''
when exists(select 1 from sigap.jadwal_piket j where j.guru_id = i.${idCol} and j.hari = ${hariDari("i." + waktuCol)}) then 'guru_piket'
else 'bk_kesiswaan' end`;
const rows = await sql.unsafe(
`select i.*, ${kapKolom("diverifikasi_oleh_id", "waktu_verifikasi")} as ver_kap,
${kapKolom("dicatat_kembali_oleh_id", "waktu_kembali")} as kem_kap
from sigap.izin_keluar i ${where} order by i.dicatat_pada desc limit ${MAX_ROWS}`,
params,
);
const kap = await kapasitasVerifikasi(sql, s.user);
const kids = [...new Set(rows.map((r: any) => r.kelompok_id).filter((x: any) => x))];
let kelompok: any[] = [];
const nama: Record<string, string> = {};
if (kids.length) {
const kapK = `case when k.diverifikasi_oleh_id is null or k.waktu_verifikasi is null then ''
when exists(select 1 from sigap.jadwal_piket j where j.guru_id = k.diverifikasi_oleh_id and j.hari = ${hariDari("k.waktu_verifikasi")}) then 'guru_piket'
else 'bk_kesiswaan' end`;
const ks = await sql.unsafe(
`select k.*, ${kapK} as ver_kap from sigap.izin_kelompok k
where k.id in (select (jsonb_array_elements_text($1::text::jsonb))::uuid) order by k.dicatat_pada desc`,
[JSON.stringify(kids)],
);
kelompok = ks.map((k: any) => {
nama[k.id] = k.kegiatan;
return {
id: k.id, timestamp: k.dicatat_pada, kegiatan: k.kegiatan, tujuan: k.tujuan, keperluan: k.keperluan,
pola_kembali: k.pola_kembali, jumlah_peserta: k.jumlah_peserta, jalur: k.jalur, alasan_khusus: k.alasan_khusus,
disetujui_oleh: k.disetujui_oleh, disetujui_oleh_id: k.disetujui_oleh_id ?? "", waktu_persetujuan: k.waktu_persetujuan ?? "",
diverifikasi_oleh: k.diverifikasi_oleh, diverifikasi_oleh_id: k.diverifikasi_oleh_id ?? "", waktu_verifikasi: k.waktu_verifikasi ?? "",
diverifikasi_kapasitas: k.ver_kap ?? "",
};
});
}
const izinOutList = rows.map((r: any) => izinOut({ ...r, kegiatan: r.kelompok_id ? nama[r.kelompok_id] ?? "" : "" }));
return { status: "success", izin: izinOutList, kelompok, canVerify: kap !== null };
}
const HARI_VALID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export async function doGetJadwalPiket(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_UNAUTH };
const rows = await sql`
select j.hari, j.guru_id, g.nama from sigap.jadwal_piket j join sigap.guru g on g.id = j.guru_id
order by array_position(array['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'], j.hari), g.nama`;
return { status: "success", jadwal: rows.map((r: any) => ({ hari: r.hari, guruId: r.guru_id, guruName: r.nama })) };
}
export async function doSetJadwalPiket(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (!isAdmin(s.user)) return { status: "error", message: "Hanya admin yang bisa mengubah jadwal piket" };
const daftar = Array.isArray(body?.schedule) ? body.schedule : [];
if (daftar.length > 200) return { status: "error", message: "Jadwal terlalu banyak." };
const seen = new Set<string>();
const items: { hari: string; guru_id: string }[] = [];
for (const it of daftar) {
const hari = typeof it?.hari === "string" ? it.hari : "";
if (!HARI_VALID.includes(hari)) return { status: "error", message: "Hari tidak valid: " + cleanText(hari, 20) };
const guruId = typeof it?.guruId === "string" ? it.guruId.trim() : "";
const k = hari + "|" + guruId;
if (seen.has(k)) continue;
seen.add(k);
items.push({ hari, guru_id: guruId });
}
const ids = [...new Set(items.map((x) => x.guru_id))];
if (ids.length) {
const ada = await sql`select id from sigap.guru where id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::text::jsonb))`;
const set = new Set(ada.map((r: any) => r.id));
const hilang = ids.find((i) => !set.has(i));
if (hilang !== undefined) return { status: "error", message: "ID guru tidak ditemukan: " + cleanText(hilang, 40) };
}
const js = JSON.stringify(items);
await sql`
with baru as (
select x.hari, x.guru_id from jsonb_to_recordset(${js}::text::jsonb) as x(hari text, guru_id text)
), d as (
delete from sigap.jadwal_piket j
where not exists (select 1 from baru b where b.hari = j.hari and b.guru_id = j.guru_id)
)
insert into sigap.jadwal_piket (hari, guru_id)
select hari, guru_id from baru
on conflict (hari, guru_id) do nothing`;
await audit(sql, s.user.name, s.user.id, "Ubah Jadwal Piket", items.length + " penugasan disimpan");
return { status: "success" };
}
