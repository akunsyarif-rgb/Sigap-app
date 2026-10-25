// deno-lint-ignore-file no-explicit-any
export const SESSION_HOURS = 6;
export const RATE_WINDOW_MS = 5 * 60 * 1000;
export const MAX_FAIL_ACCOUNT = 10;
export const MAX_FAIL_GLOBAL = 15;
export const MAX_PW_LEN = 200;
export const MSG_BAD_PASSWORD = "Password salah!";
export const MSG_RATE_LIMIT = "Terlalu banyak percobaan login gagal. Coba lagi dalam beberapa menit.";
export const MSG_DISABLED = "Akun ini sudah dinonaktifkan. Hubungi admin.";
export const MSG_SESSION_END = "Sesi berakhir, silakan login ulang.";
export async function sha256Hex(s: string): Promise<string> {
const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomHex(bytes: number): string {
const b = new Uint8Array(bytes);
crypto.getRandomValues(b);
return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string): boolean {
if (a.length !== b.length) return false;
let d = 0;
for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
return d === 0;
}
export async function verifyPassword(pw: string, storedHash: string, storedSalt: string) {
if (storedSalt) {
const h = await sha256Hex(storedSalt + ":" + pw.trim());
return safeEqual(h, storedHash) ? { matched: true, needsMigration: false } : null;
}
const h = await sha256Hex(pw.toLowerCase().trim());
return safeEqual(h, storedHash) ? { matched: true, needsMigration: true } : null;
}
const windowNow = () => Math.floor(Date.now() / RATE_WINDOW_MS);
async function failCount(sql: any, key: string): Promise<number> {
const r = await sql`select jumlah from sigap.login_gagal where kunci = ${key} and jendela = ${windowNow()}`;
return r.length ? Number(r[0].jumlah) : 0;
}
async function recordFail(sql: any, key: string): Promise<number> {
const r = await sql`
insert into sigap.login_gagal (kunci, jendela, jumlah) values (${key}, ${windowNow()}, 1)
on conflict (kunci, jendela) do update set jumlah = sigap.login_gagal.jumlah + 1
returning jumlah`;
return Number(r[0].jumlah);
}
export async function audit(sql: any, nama: string, guruId: string, aksi: string, detail = "") {
try {
await sql`insert into sigap.audit_log (nama, guru_id, aksi, detail) values (${nama}, ${guruId}, ${aksi}, ${detail})`;
} catch (_e) { /* diamkan */ }
}
function userOut(r: any) {
return { id: r.id, name: r.nama, role: r.role, jabatan: r.jabatan || "", waliKelas: r.kelas_wali || "" };
}
export async function doLogin(sql: any, body: any) {
const teacherId = typeof body?.teacherId === "string" ? body.teacherId.trim() : "";
const password = typeof body?.password === "string" ? body.password : "";
if (!password || password.length > MAX_PW_LEN) return { status: "error", message: MSG_BAD_PASSWORD };
const key = teacherId ? "akun:" + teacherId : "global";
const limit = teacherId ? MAX_FAIL_ACCOUNT : MAX_FAIL_GLOBAL;
if ((await failCount(sql, key)) >= limit) return { status: "error", message: MSG_RATE_LIMIT };
const rows = teacherId
? await sql`select * from sigap.guru where id = ${teacherId}`
: await sql`select * from sigap.guru order by created_at, id`;
let user: any = null;
let disabled = false;
let needsMigration = false;
let matchedId = "";
for (const r of rows) {
const chk = await verifyPassword(password, String(r.password_hash), String(r.salt ?? ""));
if (chk) {
if (String(r.status).toLowerCase().trim() === "nonaktif") { disabled = true; break; }
user = userOut(r);
needsMigration = chk.needsMigration;
matchedId = r.id;
break;
}
}
if (disabled) return { status: "error", message: MSG_DISABLED };
if (user) {
if (needsMigration) {
const salt = randomHex(16);
const h = await sha256Hex(salt + ":" + password.trim());
await sql`update sigap.guru set password_hash = ${h}, salt = ${salt}, updated_at = now() where id = ${matchedId}`;
}
const token = randomHex(32);
const tokenHash = await sha256Hex(token); // yang disimpan hanya hash-nya
const s = await sql`
insert into sigap.sesi (token_hash, guru_id, expires_at)
values (${tokenHash}, ${user.id}, now() + make_interval(hours => ${SESSION_HOURS}))
returning extract(epoch from expires_at) * 1000 as exp`;
try { // pembersihan oportunistik
await sql`delete from sigap.sesi where expires_at < now()`;
await sql`delete from sigap.login_gagal where jendela < ${windowNow() - 2}`;
} catch (_e) { /* diamkan */ }
await audit(sql, user.name, user.id, "Login");
return { status: "success", user, sessionToken: token, sessionExpiresAt: Number(s[0].exp) };
}
const n = await recordFail(sql, key);
if (n === limit) {
await audit(sql, "System", "-", "Login Rate Limit Triggered",
(teacherId ? "Lockout akun " + teacherId + " aktif " : "Lockout global aktif ") +
RATE_WINDOW_MS / 60000 + " menit setelah " + n + " percobaan gagal");
}
return { status: "error", message: MSG_BAD_PASSWORD };
}
export async function getSession(sql: any, token: unknown) {
if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
const th = await sha256Hex(token);
const r = await sql`
select s.login_at, s.expires_at, extract(epoch from s.expires_at) * 1000 as exp,
g.id, g.nama, g.role, g.jabatan, g.kelas_wali, g.status, g.password_changed_at
from sigap.sesi s join sigap.guru g on g.id = s.guru_id
where s.token_hash = ${th}`;
if (!r.length) return null;
const x = r[0];
const expired = new Date(x.expires_at).getTime() <= Date.now();
const pwChanged = x.password_changed_at && new Date(x.login_at).getTime() < new Date(x.password_changed_at).getTime();
if (expired || pwChanged) {
await sql`delete from sigap.sesi where token_hash = ${th}`;
return null;
}
if (String(x.status).toLowerCase().trim() === "nonaktif") return null; // akun dikunci = sesi ikut mati
return { user: userOut(x), expiresAt: Number(x.exp), tokenHash: th };
}
export async function doWhoami(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
return { status: "success", user: s.user, sessionExpiresAt: s.expiresAt };
}
export async function doLogout(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (s) {
await audit(sql, s.user.name, s.user.id, "Logout");
await sql`delete from sigap.sesi where token_hash = ${s.tokenHash}`;
}
return { status: "success" };
}
