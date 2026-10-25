// deno-lint-ignore-file no-explicit-any
import { audit, getSession, MSG_SESSION_END } from "./logic.ts";
import { cleanText, isOsis, MSG_NO_ACCESS } from "./data.ts";
import {
kapasitasLabel, kapasitasVerifikasi, MAX_ALASAN, MAX_KEPERLUAN, MSG_IZIN_HILANG, ST_DI_LUAR, ST_KEMBALI, ST_MENUNGGU,
ST_PULANG, ST_SELESAI, staf, tolakTransisi, TERBUKA_SQL, UUID_RE, wali,
} from "./izin.ts";
const MAX_KEGIATAN = 120;
const MAX_PESERTA = 60;
const MSG_KEGIATAN_HILANG = "Data kegiatan tidak ditemukan (mungkin sudah diproses pengguna lain).";
const MSG_BUKAN_PESERTA = "Ada peserta yang bukan bagian dari kegiatan ini.";
function nisnList(x: unknown): string[] {
if (!Array.isArray(x)) return [];
const out: string[] = [];
const seen = new Set<string>();
for (const it of x) {
const raw = typeof it === "string" ? it : typeof it?.nisn === "string" ? it.nisn : "";
const n = cleanText(raw, 40);
if (n && !seen.has(n)) { seen.add(n); out.push(n); }
}
return out;
}
function idList(x: unknown): string[] | null {
if (!Array.isArray(x)) return null;
const out: string[] = [];
const seen = new Set<string>();
for (const it of x) {
const s = typeof it === "string" ? it.trim().toLowerCase() : "";
if (!UUID_RE.test(s)) return null;
if (!seen.has(s)) { seen.add(s); out.push(s); }
}
return out;
}
function auditKel(k: any, tambahan: string) {
return `kegiatan=${k.kegiatan} | tujuan=${k.tujuan} | jalur=${k.jalur} | peserta=${k.jumlah_peserta} | id=${k.id}` + (tambahan ? " | " + tambahan : "");
}
async function ambilKelompok(sql: any, id: unknown) {
const s = typeof id === "string" ? id.trim() : "";
if (!UUID_RE.test(s)) return null;
const r = await sql`select * from sigap.izin_kelompok where id = ${s}`;
return r.length ? r[0] : null;
}
export async function doAddIzinKelompok(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const kegiatan = cleanText(body?.kegiatan, MAX_KEGIATAN);
if (!kegiatan) return { status: "error", message: "Nama kegiatan wajib diisi." };
const tujuan = String(body?.tujuan ?? "").trim().toLowerCase();
if (tujuan !== "kembali" && tujuan !== "pulang") {
return { status: "error", message: "Tujuan izin harus dipilih: kembali ke sekolah atau pulang." };
}
const keperluan = cleanText(body?.keperluan, MAX_KEPERLUAN);
if (!keperluan) return { status: "error", message: "Keperluan wajib diisi." };
const pola = tujuan === "kembali"
? (String(body?.pola_kembali ?? "").trim().toLowerCase() === "individual" ? "individual" : "bersama")
: "";
const peserta = nisnList(body?.peserta);
if (!peserta.length) return { status: "error", message: "Pilih minimal satu siswa peserta kegiatan." };
if (peserta.length > MAX_PESERTA) {
return { status: "error", message: "Peserta terlalu banyak (maksimal " + MAX_PESERTA + " siswa per kegiatan)." };
}
const khusus = String(body?.jalur ?? "").trim().toLowerCase() === "khusus";
let alasan = cleanText(body?.alasan_khusus, MAX_ALASAN);
let kap = null as any;
if (khusus) {
kap = await kapasitasVerifikasi(sql, s.user);
if (!kap) return { status: "error", message: "Izin Khusus hanya bisa dibuat Guru Piket yang bertugas hari ini (atau BK/Admin)." };
if (!alasan) return { status: "error", message: "Alasan pengecualian wajib diisi untuk Izin Khusus." };
} else {
alasan = "";
}
const js = JSON.stringify(peserta);
const ada = await sql`
select nisn from sigap.siswa where nisn in (select jsonb_array_elements_text(${js}::text::jsonb))`;
const adaSet = new Set(ada.map((r: any) => r.nisn));
const hilang = peserta.filter((n) => !adaSet.has(n));
if (hilang.length) {
return { status: "error", message: "Ada peserta yang tidak ditemukan di data induk siswa (NISN: " + hilang.slice(0, 5).join(", ") + ")." };
}
const bentrok = await sql`
select nama from sigap.izin_keluar
where nisn in (select jsonb_array_elements_text(${js}::text::jsonb))
and status in ('Menunggu Verifikasi','Sedang di Luar') order by nama limit 5`;
if (bentrok.length) {
return { status: "error", message: "Sudah ada izin berjalan untuk: " + bentrok.map((b: any) => b.nama).join(", ") + ". Selesaikan dulu sebelum membuat kegiatan ini." };
}
const statusAwal = khusus ? (tujuan === "pulang" ? ST_PULANG : ST_DI_LUAR) : ST_MENUNGGU;
let hasil;
try {
hasil = await sql`
with k as (
insert into sigap.izin_kelompok
(kegiatan, tujuan, keperluan, pola_kembali, jumlah_peserta, jalur, alasan_khusus,
disetujui_oleh, disetujui_oleh_id, waktu_persetujuan,
diverifikasi_oleh, diverifikasi_oleh_id, waktu_verifikasi)
values
(${kegiatan}, ${tujuan}, ${keperluan}, ${pola}, ${peserta.length}, ${khusus ? "khusus" : "normal"}, ${alasan},
${s.user.name}, ${s.user.id}, now(),
${khusus ? s.user.name : ""}, ${khusus ? s.user.id : null}, case when ${khusus}::boolean then now() end)
returning id
), p as (
insert into sigap.izin_keluar
(siswa_id, nisn, nama, kelas, keperluan, tujuan, status, jalur, alasan_khusus,
disetujui_oleh, disetujui_oleh_id, waktu_persetujuan,
diverifikasi_oleh, diverifikasi_oleh_id, waktu_verifikasi, waktu_keluar, kelompok_id)
select sw.id, sw.nisn, sw.nama, sw.kelas, ${keperluan}, ${tujuan}, ${statusAwal}, ${khusus ? "khusus" : "normal"}, ${alasan},
${s.user.name}, ${s.user.id}, now(),
${khusus ? s.user.name : ""}, ${khusus ? s.user.id : null},
case when ${khusus}::boolean then now() end, case when ${khusus}::boolean then now() end, k.id
from sigap.siswa sw cross join k
where sw.nisn in (select jsonb_array_elements_text(${js}::text::jsonb))
returning id
)
select (select id from k) as kid, (select count(*)::int from p) as n`;
} catch (e: any) {
if (e?.code === "23505") {
return { status: "error", message: "Ada peserta yang baru saja mendapat izin lain. Muat ulang lalu coba lagi." };
}
throw e;
}
const kid = hasil[0].kid;
const kel = (await sql`select * from sigap.izin_kelompok where id = ${kid}`)[0];
const namaPeserta = (await sql`select nama from sigap.izin_keluar where kelompok_id = ${kid} order by nama`).map((r: any) => r.nama).join(", ");
await audit(sql, s.user.name, s.user.id, khusus ? "Izin Kelompok Khusus" : "Persetujuan Izin Kelompok",
auditKel(kel, "siswa=" + namaPeserta + (khusus ? " | alasan pengecualian=" + alasan + " | kapasitas=" + kapasitasLabel(kap) : "")));
return { status: "success", id: kid, izinStatus: statusAwal, jumlahPeserta: Number(hasil[0].n) };
}
async function pesertaDipilih(sql: any, kid: string, ids: string[] | null) {
const semua = await sql`select id, nama, status, tujuan, kelas from sigap.izin_keluar where kelompok_id = ${kid} order by nama`;
if (ids === null) return { semua, dipilih: semua, ok: true };
const milik = new Set(semua.map((p: any) => p.id));
if (ids.some((i) => !milik.has(i))) return { semua, dipilih: [], ok: false };
const pilih = new Set(ids);
return { semua, dipilih: semua.filter((p: any) => pilih.has(p.id)), ok: true };
}
export async function doVerifikasiIzinKelompok(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const kap = await kapasitasVerifikasi(sql, s.user);
if (!kap) return { status: "error", message: "Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa memverifikasi." };
const kel = await ambilKelompok(sql, body?.id);
if (!kel) return { status: "error", message: MSG_KEGIATAN_HILANG };
let ids: string[] | null = null;
if (Array.isArray(body?.pesertaIds) && body.pesertaIds.length) {
ids = idList(body.pesertaIds);
if (ids === null) return { status: "error", message: MSG_BUKAN_PESERTA };
}
const { semua, dipilih, ok } = await pesertaDipilih(sql, kel.id, ids);
if (!semua.length) return { status: "error", message: "Kegiatan ini tidak punya peserta." };
if (!ok) return { status: "error", message: MSG_BUKAN_PESERTA };
const target = dipilih.filter((p: any) => p.status === ST_MENUNGGU);
if (!target.length) return { status: "error", message: "Tidak ada peserta yang menunggu verifikasi pada kegiatan ini." };
const baru = kel.tujuan === "pulang" ? ST_PULANG : ST_DI_LUAR;
const tj = JSON.stringify(target.map((p: any) => p.id));
const up = await sql`
update sigap.izin_keluar set status = ${baru}, diverifikasi_oleh = ${s.user.name}, diverifikasi_oleh_id = ${s.user.id},
waktu_verifikasi = now(), waktu_keluar = now(), jam_perkiraan_kembali = ''
where kelompok_id = ${kel.id} and status = ${ST_MENUNGGU}
and id in (select (jsonb_array_elements_text(${tj}::text::jsonb))::uuid)
returning id`;
if (!up.length) return { status: "error", message: "Tidak ada peserta yang menunggu verifikasi pada kegiatan ini." };
if (!kel.diverifikasi_oleh_id) {
await sql`update sigap.izin_kelompok set diverifikasi_oleh = ${s.user.name}, diverifikasi_oleh_id = ${s.user.id}, waktu_verifikasi = now()
where id = ${kel.id} and diverifikasi_oleh_id is null`;
}
await audit(sql, s.user.name, s.user.id, "Verifikasi Izin Kelompok",
auditKel(kel, `diverifikasi=${up.length} | tidak diverifikasi=${semua.length - up.length} | status=${baru} | kapasitas=${kapasitasLabel(kap)}`));
return { status: "success", izinStatus: baru, jumlahDiverifikasi: up.length };
}
export async function doTandaiKembaliKelompok(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const kap = await kapasitasVerifikasi(sql, s.user);
if (!kap) return { status: "error", message: "Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menandai siswa kembali." };
const kel = await ambilKelompok(sql, body?.id);
if (!kel) return { status: "error", message: MSG_KEGIATAN_HILANG };
if (!Array.isArray(body?.pesertaIds) || !body.pesertaIds.length) {
return { status: "error", message: "Pilih dulu siswa mana saja yang sudah benar-benar kembali." };
}
const ids = idList(body.pesertaIds);
if (ids === null) return { status: "error", message: MSG_BUKAN_PESERTA };
const { semua, dipilih, ok } = await pesertaDipilih(sql, kel.id, ids);
if (!ok) return { status: "error", message: MSG_BUKAN_PESERTA };
for (const p of dipilih) {
if (p.status !== ST_DI_LUAR) return { status: "error", message: p.nama + ": " + tolakTransisi(p.status, "kembali") };
}
const tj = JSON.stringify(dipilih.map((p: any) => p.id));
const up = await sql`
update sigap.izin_keluar set status = ${ST_SELESAI}, waktu_kembali = now(), dicatat_kembali_oleh = ${s.user.name}, dicatat_kembali_oleh_id = ${s.user.id}
where kelompok_id = ${kel.id} and status = ${ST_DI_LUAR}
and id in (select (jsonb_array_elements_text(${tj}::text::jsonb))::uuid)
returning id`;
const pilih = new Set(ids);
const belum = semua.filter((p: any) => p.status === ST_DI_LUAR && !pilih.has(p.id));
await audit(sql, s.user.name, s.user.id, "Tandai Rombongan Kembali",
auditKel(kel, `kembali=${up.length} | belum kembali=${belum.length}` +
(belum.length ? " (" + belum.map((p: any) => p.nama).join(", ") + ")" : "") + " | kapasitas=" + kapasitasLabel(kap)));
return { status: "success", jumlahKembali: up.length, jumlahBelumKembali: belum.length };
}
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const pad2 = (n: number) => String(n).padStart(2, "0");
function labelStatusSurat(st: string) {
if (st === ST_DI_LUAR) return "Sedang di Luar Sekolah";
if (st === ST_PULANG) return "Pulang (Tidak Kembali ke Sekolah)";
if (st === ST_SELESAI || st === ST_KEMBALI) return "Selesai (Sudah Kembali ke Sekolah)";
return st;
}
export async function doGenerateIzinSurat(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const idStr = typeof body?.izinId === "string" ? body.izinId.trim() : "";
if (!idStr) return { status: "error", message: "ID izin wajib diisi." };
const MSG_TIDAK_ADA = "Data izin tidak ditemukan (mungkin sudah dihapus).";
if (!UUID_RE.test(idStr)) return { status: "error", message: MSG_TIDAK_ADA };
const w = wali(s.user);
const r = await sql`
select i.*,
(${staf(s.user)}::boolean
or i.status in ('Menunggu Verifikasi','Sedang di Luar')
or (i.dicatat_pada at time zone 'Asia/Makassar')::date = (now() at time zone 'Asia/Makassar')::date
or (${w}::text <> '' and i.kelas_norm <> '' and i.kelas_norm = sigap.norm_kelas(${w}::text))) as boleh
from sigap.izin_keluar i where i.id = ${idStr}`;
if (!r.length) return { status: "error", message: MSG_TIDAK_ADA };
const izin = r[0];
if (!izin.boleh) return { status: "error", message: "Tidak punya akses untuk mencetak surat izin ini." };
if (izin.kelompok_id) return { status: "error", message: "Surat untuk peserta kegiatan kelompok belum didukung." };
if (![ST_DI_LUAR, ST_PULANG, ST_SELESAI, ST_KEMBALI].includes(izin.status)) {
return { status: "error", message: "Surat hanya bisa dicetak setelah izin diverifikasi Guru Piket (status saat ini: " + izin.status + ")." };
}
const nomor = (await sql`select sigap.beri_nomor_surat(${izin.id}) as no`)[0].no as string;
const up = await sql`
update sigap.izin_keluar set waktu_print = now(), status_print = 'Sudah' where id = ${izin.id} returning waktu_print`;
if (!up.length) return { status: "error", message: MSG_TIDAK_ADA };
let konteks = "";
if (izin.jalur !== "khusus") {
const a = await sql`
select detail from sigap.audit_log
where aksi = 'Persetujuan Izin Keluar' and detail like ${"%| id=" + izin.id}
order by id desc limit 1`;
if (a.length) {
const m = [...String(a[0].detail).matchAll(/konteks=(Wali Kelas|Guru Mapel)/g)];
if (m.length) konteks = m[m.length - 1][1];
}
if (!konteks) {
const g = await sql`
select (${izin.kelas_norm}::text <> '' and sigap.norm_kelas(coalesce(kelas_wali,'')) = ${izin.kelas_norm}::text) as wk
from sigap.guru where id = ${izin.disetujui_oleh_id}`;
konteks = g.length && g[0].wk ? "Wali Kelas" : "Guru Mapel";
}
}
const t = new Date(Date.now() + 8 * 3600 * 1000);
const suratData = {
izinId: izin.id,
nomor_surat: nomor,
tgl_cetak: `${HARI[t.getUTCDay()]}, ${t.getUTCDate()} ${BULAN[t.getUTCMonth()]} ${t.getUTCFullYear()}`,
jam_cetak: `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())} WITA`,
nama_siswa: izin.nama,
kelas: izin.kelas,
tujuan: izin.tujuan === "pulang" ? "Pulang" : "Kembali",
keperluan: izin.keperluan,
jalur: izin.jalur,
alasan_khusus: izin.alasan_khusus,
waktu_persetujuan: izin.waktu_persetujuan ?? "",
waktu_verifikasi: izin.waktu_verifikasi ?? "",
waktu_keluar: izin.waktu_keluar ?? "",
waktu_kembali: izin.waktu_kembali ?? "",
jam_perkiraan_kembali: izin.jam_perkiraan_kembali,
disetujui_oleh: izin.disetujui_oleh,
konteks_persetujuan: konteks,
diverifikasi_oleh: izin.diverifikasi_oleh,
status_izin: izin.status,
status_izin_label: labelStatusSurat(izin.status),
};
await audit(sql, s.user.name, s.user.id, "generateIzinKeluarSurat",
`${izin.nama} (${izin.nisn}) | kelas=${izin.kelas} | nomor=${nomor} | status_saat_cetak=${izin.status} | id=${izin.id}`);
return { status: "success", data: { suratData, nomorSurat: nomor } };
}
export { TERBUKA_SQL };
