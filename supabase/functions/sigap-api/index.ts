// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3.4.5";
import { doLogin, doLogout, doWhoami } from "./logic.ts";
import { doAddPelanggaran, doAddPelanggaranKelompok, doGetPelanggaran, doGetPelanggaranCount } from "./pelanggaran.ts";
import { doAddUpacara, doGetUpacara, doAddBimbingan, doGetBimbingan, doAjukanTindakLanjut, doApproveTindakLanjut, doGetTindakLanjut } from "./tahap6.ts";
import { doAddIzin, doVerifikasiIzin, doTandaiKembaliIzin, doTandaiPulangIzin, doDeleteIzin, doGetIzin, doGetJadwalPiket, doSetJadwalPiket } from "./izin.ts";
import { doAddIzinKelompok, doVerifikasiIzinKelompok, doTandaiKembaliKelompok, doGenerateIzinSurat } from "./izin2.ts";
import {
doGetLoginUsers, doGetStudents, doGetTeachers, doGetWaliKelasMap, doGetAuditLog, doGetTodayData, doAddTeacher, doUpdatePassword,
doChangeMyPassword, doUpdateJabatan, doUpdateRole, doUpdateWaliKelas, doUpdateTeacherName, doDeleteTeacher, doToggleTeacherStatus,
doAddStudent, doVerifyStudent, doDeleteStudent,
} from "./kelola.ts";
import { doExportData } from "./export.ts";
import { doHapusDataPeriode, doPreviewHapusData } from "./hapus.ts";
import { doLogClientError } from "./errorlog.ts";
import { doDeletePushSubscription, doSavePushSubscription } from "./push.ts";
import { doAddSurat, doDeleteEntry, doEditEntry, doGetSurat, doGetLateHistory, doGetLogs, doRecord } from "./data.ts";
const CORS = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
"Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
function json(obj: unknown, status = 200) {
return new Response(JSON.stringify(obj), {
status,
headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
}
let _sql: any = null;
function getSql() {
if (!_sql) {
_sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 });
}
return _sql;
}
const ACTIONS: Record<string, (sql: any, body: any) => Promise<unknown>> = {
login: doLogin,
logout: doLogout,
whoami: doWhoami,
record: doRecord,
getLogs: doGetLogs,
getStudentLateHistory: doGetLateHistory,
editEntry: doEditEntry,
deleteEntry: doDeleteEntry,
addSurat: doAddSurat,
getSurat: doGetSurat,
addPelanggaran: doAddPelanggaran,
addPelanggaranKelompok: doAddPelanggaranKelompok,
getPelanggaran: doGetPelanggaran,
getPelanggaranCountForStudent: doGetPelanggaranCount,
addPelanggaranUpacara: doAddUpacara,
getPelanggaranUpacara: doGetUpacara,
addBimbingan: doAddBimbingan,
getBimbingan: doGetBimbingan,
ajukanTindakLanjut: doAjukanTindakLanjut,
approveTindakLanjut: doApproveTindakLanjut,
getTindakLanjut: doGetTindakLanjut,
addIzinKeluar: doAddIzin,
verifikasiIzinKeluar: doVerifikasiIzin,
tandaiKembaliIzinKeluar: doTandaiKembaliIzin,
tandaiPulangIzinKeluar: doTandaiPulangIzin,
deleteIzinKeluar: doDeleteIzin,
getIzinKeluar: doGetIzin,
addIzinKelompok: doAddIzinKelompok,
verifikasiIzinKelompok: doVerifikasiIzinKelompok,
tandaiKembaliKelompok: doTandaiKembaliKelompok,
generateIzinKeluarSurat: doGenerateIzinSurat,
getLoginUsers: doGetLoginUsers,
getStudents: doGetStudents,
getTeachers: doGetTeachers,
getWaliKelasMap: doGetWaliKelasMap,
getAuditLog: doGetAuditLog,
getTodayData: doGetTodayData,
addTeacher: doAddTeacher,
updatePassword: doUpdatePassword,
changeMyPassword: doChangeMyPassword,
updateJabatan: doUpdateJabatan,
updateRole: doUpdateRole,
updateWaliKelas: doUpdateWaliKelas,
updateTeacherName: doUpdateTeacherName,
deleteTeacher: doDeleteTeacher,
toggleTeacherStatus: doToggleTeacherStatus,
addStudent: doAddStudent,
verifyStudent: doVerifyStudent,
deleteStudent: doDeleteStudent,
exportData: doExportData,
previewHapusData: doPreviewHapusData,
hapusDataPeriode: doHapusDataPeriode,
logClientError: doLogClientError,
savePushSubscription: doSavePushSubscription,
deletePushSubscription: doDeletePushSubscription,
getJadwalPiket: doGetJadwalPiket,
setJadwalPiket: doSetJadwalPiket,
};
Deno.serve(async (req: Request) => {
if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
try {
if (req.method === "GET") return json({ status: "ok", service: "sigap-api" });
if (req.method !== "POST") return json({ status: "error", message: "Metode tidak didukung." }, 405);
const text = await req.text();
if (text.length > 65536) return json({ status: "error", message: "Permintaan terlalu besar." }, 413);
let body: any;
try { body = JSON.parse(text); } catch (_e) { return json({ status: "error", message: "Permintaan tidak valid." }, 400); }
const handler = typeof body?.action === "string" && Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
if (!handler) return json({ status: "error", message: "Aksi tidak dikenali." }, 400);
return json(await handler(getSql(), body));
} catch (e) {
console.error("sigap-api error:", e instanceof Error ? e.message : String(e));
return json({ status: "error", message: "Server sedang bermasalah, coba lagi sebentar." }, 500);
}
});
