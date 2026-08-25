# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SIGAP: a Google Apps Script (GAS) web app for SMAN 2 Tarakan that logs student
lateness, violations ("pelanggaran"), incoming letters ("surat"), and ceremony
("upacara") infractions, with role-based views for admin/BK-kesiswaan/guru/OSIS.
Google Sheets is the database (via `SpreadsheetApp`). Surat is a written report
only (jenis + keterangan) — photo attachment was removed after repeatedly
failing in the field on Google Workspace Drive-sharing authorization; see the
comment at the top of `Utils.gs` where `uploadFotoSurat` used to live. The
`Foto_URL` column still exists in the `Surat_Masuk` sheet (old rows may still
have a value) but is no longer written or read by any UI — don't resurrect a
photo upload/display feature without re-reading that history first.

**There is no build step for the frontend** (see `package.json` description).

## Two SEPARATE deploy targets — merging to `main` does NOT deploy both

This repo maps to two independently-deployed systems, and a merged PR only
ever auto-deploys one of them:

- **Frontend** (`index.html` + every `*.js` except `.gs` files) is hosted as a
  static site (observed live on Vercel) that auto-redeploys on every push to
  `main`. No action needed after merging a frontend-only PR.
- **Backend** (`Code.gs`, `Auth.gs`, `Utils.gs`) is a Google Apps Script Web
  App bound to the Google Sheet used as the database. **Nothing in this repo
  auto-deploys it.** Merging a PR that touches a `.gs` file changes the code
  on GitHub only — the live Web App keeps running whatever was last manually
  deployed until someone explicitly pushes + redeploys via `clasp` (see below)
  or by hand-copying the file contents into the Apps Script editor and
  creating a new deployment version. **A `.gs`-touching PR is not actually
  live until this manual step happens** — say so explicitly when finishing
  such a change, don't assume merge == deployed.

### clasp (Apps Script CLI)

- `.claspignore` restricts `clasp push` to only the `.gs` files + `appsscript.json`.
  **`appsscript.json` is not in the repo** and never has been. It matters
  because `clasp push` calls `projects.updateContent`, which replaces the
  project's *entire* content — pushing with no manifest either errors or wipes
  the live one, and the manifest is what holds the timezone, `oauthScopes`, and
  the `webapp` `access`/`executeAs` settings that decide whether teachers can
  open the Web App at all. `deploy-gas.yml` handles this by `clasp pull`ing the
  live manifest into a temp dir and copying it in verbatim before pushing, so a
  deploy only ever changes the three `.gs` files. If you ever commit a real
  `appsscript.json`, the workflow prefers the repo's copy — get it from
  `clasp pull`, don't hand-write it.
- `.clasp.json` is gitignored (copy `.clasp.json.example` → `.clasp.json` and
  fill in the real `scriptId` from Apps Script Project Settings — this is
  per-person/per-checkout, not committed).
- `npm run clasp:login` / `clasp:push` / `clasp:deploy`. A bare `clasp deploy`
  creates a **new** deployment with a **different** Web App URL that the live
  `config.js` knows nothing about — and it does not error, so the only symptom
  is teachers still running the old code. `clasp:deploy` used to be exactly
  that (`clasp push && clasp deploy`); it now runs
  `.github/scripts/clasp-deploy-existing.js`, which refuses to start without
  `CLASP_DEPLOYMENT_ID` and always passes `-i`:
  `CLASP_DEPLOYMENT_ID=<id> npm run clasp:deploy` (find the id via
  `clasp deployments`, matching `API_URL` in `config.js`). No path in this repo
  — CI or local — can create a deployment; `tests/deploy-workflow.test.js`
  greps for a bare `clasp deploy`/`create-deployment` and fails the build.
- `.github/workflows/deploy-gas.yml` is an opt-in, `workflow_dispatch`-only
  (manual button, not automatic on push) CI job that does the push +
  `clasp deploy -i` for you, gated behind three repo secrets
  (`CLASP_CREDENTIALS`, `CLASP_SCRIPT_ID`, `CLASP_DEPLOYMENT_ID`) that must be
  configured before it can run. Every step before `clasp push` is read-only, so
  a misconfigured secret aborts the run without touching the live project.
- `.github/scripts/check-clasp-credentials.js` is the first of those steps
  (unit-tested by `tests/clasp-credentials.test.js`). It exists because both
  ways this can fail are silent: an unset secret interpolates to an **empty
  string**, so the old `echo '${{ secrets.X }}' > ~/.clasprc.json` wrote a blank
  file and clasp died with the useless `Unexpected end of JSON input` (its
  `FileCredentialStore.readFile` does a bare `JSON.parse`); and `clasp deploy
  -i ""` does **not** error — clasp v3 tests `if (!deploymentId)`, so an empty
  `CLASP_DEPLOYMENT_ID` silently creates a *new* deployment on a *new* URL while
  every teacher keeps hitting the old one. The script mirrors clasp's own
  credential normalization (v3 `tokens.default`, plus both legacy v1 shapes) and
  checks for `client_id`/`client_secret`/`refresh_token`, which
  `GoogleAuth().fromJSON()` requires. It reports shapes, never values — keep it
  that way, its log is visible to anyone with repo access.
- Secrets reach the shell through `env:`, never interpolated into the command
  text: a `'` inside `~/.clasprc.json` used to break the quoting outright
  (`echo '<value>'` dies with a shell syntax error). `printf '%s' "$VAR"` writes
  it back byte-identical, multiline and special characters included.
- `.github/scripts/verify-clasp-target.js` is the second gate (tested by
  `tests/clasp-target.test.js`). Valid-but-*wrong* secrets are the failure the
  credential check can't see: a `CLASP_DEPLOYMENT_ID` belonging to another
  project or since deleted lets `clasp push` mutate the live project and only
  then fails at `clasp deploy -i`, leaving teachers on a version nobody tested.
  `clasp deployments --json` lists deployments **for the configured scriptId**,
  so finding the id in that list proves both that it exists and that it belongs
  to this project. The step also re-checks `.clasp.json`'s `scriptId` against
  `CLASP_SCRIPT_ID` so a stray `.clasp.json` can't redirect the push. It reads
  the list from a file under `RUNNER_TEMP` and never prints it — other
  deployments' ids are in there.
- Ordering is load-bearing and `tests/deploy-workflow.test.js` asserts it:
  every read-only gate (credential check → deployment verify → `clasp pull` →
  `clasp status`) runs before the first write (`clasp push`). Keep new steps on
  the correct side of that line.

## Commands

```bash
npm install       # once, to get @babel/core + @babel/preset-react for tests + clasp
npm test          # runs node --test tests/*.test.js (all tests)
node --test tests/password.test.js       # run a single test file
node --test tests/render-smoke.test.js   # the other test file
```

CI (`.github/workflows/test.yml`) runs `npm install && npm test` on every push/PR to `main`.
`.github/workflows/deploy-gas.yml` is separate — see clasp section above.

There is no linter/formatter configured in this repo.

## Architecture

### Backend: Google Apps Script (`*.gs` files)

All `.gs` files in a GAS project share one global scope automatically (no
imports) — declaration order across files doesn't matter, only within-file
order does for anything not hoisted.

- **`Code.gs`** — the entire router. `doPost(e)` handles every mutating/auth
  action (`login`, `logout`, record/edit/delete entries, admin actions, audit
  log, etc.) via `if (action === '...')` chains reading `data.action` from the
  JSON POST body. `doGet(e)` handles read-only list/status actions via query
  params. Every request (`doPost` and `doGet`, except the bare status ping) is
  gated by `checkToken()` (shared `API_TOKEN`), and every action beyond
  `login`/`logout` additionally requires a valid session (`getSessionUser`).
- **`Auth.gs`** — session creation/lookup (`createSession`/`getSessionUser`,
  backed by `CacheService`, 6h max TTL — a hard GAS `CacheService.put()` limit,
  not a design choice). Because 6h is a per-`put()` cap, `getSessionUser()`
  **re-`put`s the record on every authenticated request** (so a busy session's
  cache entry is not evicted early — Apps Script may drop entries before TTL) and
  publishes the session's real deadline via the `SESSION_RENEWED_UNTIL` global,
  which `jsonOut` attaches to the response as `sessionExpiresAt`. **The session
  lifetime policy is unchanged: 6h from login, never extended.** That cap is now
  enforced explicitly against `loginAt` (stored inside the record) rather than
  relying on the cache entry's own TTL, so the re-`put` keeps the entry from
  being evicted early without ever lengthening the session. Session records
  created by the previous backend (a bare user object, no wrapper) are still
  honored until they expire, but are not re-`put`. Also password verification (`verifyPassword`, supports
  both the legacy unsalted-lowercased SHA-256 scheme and the current salted
  scheme, with automatic migration on next successful login). Role helpers
  (`isAdminRole`, `isBkRole`, `isOsisRole`) normalize and check role strings.
- **`Utils.gs`** — cross-cutting helpers: `jsonOut`, `checkToken`, password
  hashing (`hashPasswordLegacy`/`hashPasswordSalted`), `sameClass` (tolerant
  class-name matching — mirrors `normalizeClass()` in `helpers.js`, keep both
  in sync if changed), `logAudit` (writes to a separate `Audit_Log` sheet, never
  throws; readable by admin only — see `getAuditLog`), `getRowsSince` (binary-search over timestamps to avoid scanning
  full sheets), and **login rate limiting** (`isLoginRateLimited`/
  `recordLoginFailure`): the rate limiter is a **global, fixed 5-minute
  window** (not per-account, not sliding) capped at 15 failures. It's global
  because login used to be password-only, so a failed attempt couldn't be
  attributed to one account — still true of the legacy path below, so it stays
  global.

### Login flow (two paths, both live)

`LoginScreen` (`ui-common.js`) shows a **searchable teacher selector**: it
fetches `getLoginUsers` — a `doGet` action that is deliberately **session-free**
(it's called before anyone is logged in; gated by `API_TOKEN` only) and returns
**only `{id, name}`** for non-`nonaktif` rows. Never add role/jabatan/status/
hash/salt to that response — it is served unauthenticated.

- **With a teacher picked**, the client sends `teacherId` and the server checks
  only that row of `Master_Guru`.
- **Without one** (list still loading, or the fetch failed — this fallback is
  intentional and must keep working), no `teacherId` is sent and the server
  matches the password against every row, as it always did.

Three rules in `LoginScreen` exist because of a real field bug — read the
comment block above the component before touching it: the form must be usable
on the first frame (never disable it or cover it with an overlay while
`getLoginUsers` is in flight), its field structure must not change between the
loading/ready/error states, and a failed fetch must degrade to legacy login
*with* a visible message. `tests/login.test.js` enforces all three.

### Session lifecycle (client)

The session lives in **one** `localStorage` key, `sigap_session`, holding
`{v, token, user, expiresAt, loginAt}` — written with a single `setItem`.
It used to be three separate keys (`sigap_session_token`/`sigap_user`/
`sigap_session_expires`) written by three consecutive `setItem` calls inside
one `try`; a failure on the 2nd or 3rd (quota — the same origin also writes a
few-hundred-KB `sigap_data_cache`, and an iOS Home Screen web app gets its own
tighter storage allowance) left a **torn** record that the reader reported as
"expired", producing a bogus "Sesi sebelumnya sudah berakhir". The old keys are
still **read** (and migrated + deleted on first boot) so a deploy never logs
anyone out; they are never written again. Don't split the record back up.

The expiry stamp itself **refuses to render the logged-in UI from a stored
session past it**. Without it the app rendered the logged-in shell (teacher's
name in the Header) from an already-dead server session, sat there unusable for
several seconds, then yanked it away when the first API response came back
`Sesi berakhir` — exactly what users reported as "the name disappears by
itself". Don't remove the stamp. A record that merely **fails to parse** is
reported as *no session* (silent login screen), not as *expired* — "unknown"
must never be shown to a teacher as "your session ended".

`checkSession` (the guard chained onto all 36 API responses) is **scoped to the
token the request was sent with**, via `shouldClearSessionForResponse()` in
`helpers.js`. Matching only the `Sesi berakhir` message — as it did before —
meant a late response belonging to a *dead* session could land after the
teacher had already logged back in and wipe the **new** session. That was the
reported "login succeeds, then it logs straight back out, every time" bug,
which showed up once the app was added to the iPhone Home Screen: launching
from the icon is the one flow that routinely starts from a stored-but-
server-dead session, so boot fires its 7 parallel requests under a dead token
and the stragglers land after the re-login. `activeSessionToken` is a **ref**,
not state, so a new token is visible to in-flight responses immediately rather
than one render later. Keep both properties.

Successful responses carrying `sessionExpiresAt` sync the stored stamp to the
server's own deadline via `nextSessionExpiry`, which never shortens it and never
grants more than one full TTL — with the 6h-from-login cap the server reports
the same deadline the client already computed at login, so in practice this only
keeps the two from drifting. A backend that hasn't been redeployed yet sends no
such field, and the client then behaves exactly as before — so the frontend can
ship ahead of the `.gs` deploy without regressing.

### Pelanggaran Upacara: who sees what

`getPelanggaranUpacara` is the single source for both the Upacara tab's Rekap
view and the Upacara category in Rekap Kelas — there is no second rekap system.
Authorization is server-side in `Code.gs`, not just hidden menus:

- admin / bk_kesiswaan → whole school
- **osis → whole school** (was own-records-only; widened deliberately so OSIS
  can use Rekap as a shared reading tool). OSIS remains locked out of every
  other discipline category — `getLogs`/`getSurat`/`getPelanggaran`/
  `getTindakLanjut` reject `isOsisRole` explicitly, `getBimbingan` allowlists
  `isBkRole`. Keep it that way.
- guru who is a wali kelas → their class only (filtered by `sameClass`)
- plain guru → `Unauthorized`

Rekap lives *inside* the existing Upacara menu as a Catat/Rekap switch — no new
BottomNav entry. The data is lazy-loaded under the `'upacara'` key in `app.js`
(`loadOnce`), shared by the `upacara` and `rekap` tabs so opening both doesn't
fetch twice.

Data lives in named sheets: `Master_Guru`, `Master_Siswa`, `Log_Gerbang`,
`Pelanggaran`, `Surat_Masuk`, `Izin_Keluar`, `Izin_Kelompok`, `Audit_Log`, `Error_Log`. Column positions are
significant and accessed by index (e.g. `Master_Guru` col H/index 7 = salt) —
check existing row-index comments before touching sheet read/write code.
`LockService` guards concurrent writes to shared sheets.

### Frontend: React with no bundler

`index.html` is the only real entry point. At load time it:
1. `fetch()`es a fixed, ordered list of `.js` files in parallel (order matters —
   later files reference globals/components defined in earlier ones; this is
   NOT resolved by any module system).
2. Joins their text together and runs the combined source through
   `Babel.transform` **once**, with `runtime: 'classic'` explicitly forced
   (an unpinned Babel version once defaulted to `automatic` JSX runtime, which
   injects an `import` statement and silently white-screens the app — see the
   comment in `index.html`).
3. Injects the transformed result as one `<script>` tag.

File load order (`index.html`'s `files` array):
`config.js → helpers.js → export-format.js → ui-common.js → admin.js → beranda-riwayat.js → statistik.js → gerbang.js → pelanggaran-bimbingan-upacara.js → rekap-kelas.js → export-data.js → app.js`

- **`config.js`** — `API_URL`/`API_TOKEN` (sent from every client; there is no
  way to truly hide this in a bundler-less static-JS app), the `ROLES` map
  (per-role menu lists + `canExport`/`canViewRanking` flags), and `NAV_ITEMS`
  (icons/labels per menu key). This is the source of truth for what each role
  can see — cross-reference here first when changing access control.
- **`helpers.js`** — pure functions (date formatting, period math, chart data
  shaping, CSV export) used by nearly every tab file.
- **`ui-common.js`** — shared small components (Badge, stat cards, bar chart)
  plus `LoginScreen`, Header, and Bottom Nav.
- **`app.js`** (loaded last) — the `App()` root component: login/session flow
  (session persisted in `localStorage`, server session lives 6h — the two are
  independent, client-side "logged in" state can outlive the server session),
  all data fetching, all save/edit/delete handlers, and the top-level render/
  routing between tabs. Also computes runtime-only access rules not expressible
  as static role config — e.g. Rekap Kelas access for a `guru` who is a wali
  kelas is granted per-person here, not via `ROLES` in `config.js`.
- **`export-format.js`** — pure, dependency-free builders for the Export Data
  feature: a minimal PDF writer (Helvetica/Helvetica-Bold, no embedding, own
  xref table) and a minimal XLSX writer (ZIP with stored — uncompressed —
  entries, inline strings). Deliberately hand-rolled instead of pulling
  jsPDF/SheetJS from a CDN: there is no build step, so a ~1 MB library would
  be paid on **every** app open, not just on export. Don't add such a
  dependency without re-reading that trade-off. Byte-level structure is
  covered by `tests/export-frontend.test.js` (it re-parses the ZIP and walks
  the PDF xref) — if you touch these writers, that suite is what proves the
  files still open.
- Remaining files (`gerbang.js`, `beranda-riwayat.js`,
  `pelanggaran-bimbingan-upacara.js`, `rekap-kelas.js`, `statistik.js`,
  `admin.js`, `export-data.js`) are one file per feature tab/group of tabs,
  named after what they contain.

**Cache-busting**: `index.html` has a manually-incremented `BUILD_VERSION`
constant appended as `?v=` to every fetched file. **Bump this on every deploy
that touches any `.js` file** — otherwise returning users keep serving stale
cached files indefinitely.

**CDN dependencies** are pinned to major-version tags, not floating `latest`,
and use production (not development) builds:
`react@18`/`react-dom@18` → `production.min.js`, `@babel/standalone@7`. Keep
this pattern (major-version pin, not exact patch — unverifiable exact patches
risk 404s from unpkg; not `latest` — risks silent breaking upgrades) when
touching these `<script>` tags.

### Read scope: Keterlambatan, Surat & Pelanggaran (RBAC)

`scopeDailyRecordsForUser()` (Keterlambatan + Surat) and
`scopePelanggaranForUser()` (Pelanggaran) in `Utils.gs` are the single source of
truth, applied server-side by `getLogs`, `getSurat`, `getPelanggaran`,
`getStudentLateHistory`, and `getTodayData`. The two categories deliberately
follow **different** rules — don't unify them:

| | Keterlambatan & Surat | Pelanggaran |
| --- | --- | --- |
| admin / bk_kesiswaan | whole school | whole school |
| wali kelas | own class (any date) + everything from **today** | own class + own records, any date |
| plain guru | everything from **today** only | own records, any date |
| osis | rejected | rejected |

**Today is school-wide** for lateness and surat because gate duty teachers must
see each other's entries or the same student gets recorded twice (`GerbangTab`,
and the duplicate checks in `record`/`addSurat`). "OWN-hari-ini" needs no clause
of its own — it is fully contained in that today rule. What must *not* come back
is an unrestricted OWN clause: a wali kelas who does gate duty would otherwise
keep a cross-class history forever, just because they typed it. Pelanggaran is
the opposite case (no mass gate flow, teachers need to trace their own entries),
so it keeps unrestricted OWN.

`getLogs` and `getSurat` used to return the *entire* sheet to every non-OSIS
caller and let the browser decide what to show — a plain guru could read any
class's history straight out of the Network tab. When touching these handlers,
keep the cache **raw** (`today_logs`, `surat_list`, `pelanggaran_list_raw`,
`today_data` all store the unfiltered list) and scope **after** reading it;
caching a per-user result hands one teacher's list to the next caller.
`tests/rbac-riwayat-pelanggaran.test.js` calls `doGet()` for real and pins all
of this down, cache leakage and parameter tampering included.

Visibility is not the edit rule: the 5-minute edit/delete window in
`editEntry`/`deleteEntry` is unchanged and independent of this.

Ownership (OWN) uses the existing mechanism — the `Dicatat_Oleh` column matched
against the session user's name, same as `editEntry`/`deleteEntry`. Don't
replace it with ids "while you're in there": old rows only carry the name.

`getStudentLateHistory` returns scoped detail rows **plus** `count`, the
student's true school-wide total as a bare number. That count is what keeps the
"sudah Nx terlambat" warning in `RecordModal` honest now that a guru's
`allLogs` only holds today. Same deliberate trade-off (and same reasoning) as
`getPelanggaranCountForStudent`: per-student, on demand, never an all-students
map that could be turned into a ranking.

`BACKEND_VERSION` in `Code.gs` is echoed by the token-gated status ping
(`doGet` with no action). Bump it whenever a `.gs` change needs verifying after
a manual deploy — it's the only way to tell "deployed" from "saved but still
serving the old version" without guessing.

### Izin Keluar / Pulang (BETA)

A **stateful transaction**, not another Surat row: it tracks a student
*leaving school grounds* and stays open until they come back (or were going
home anyway). Sheet `Izin_Keluar`, 20 columns, positions significant — see
`IZIN_HEADERS` in `Utils.gs`. It lives as a **third mode inside Gerbang**
("Izin Keluar · BETA"), not a new BottomNav entry (nav space is already full —
see the long note on `ROLES` in `config.js`) and not a new role.

The school's two-step procedure is kept as two steps and must stay that way:

```
Guru pemberi persetujuan -> persetujuan | addIzinKeluar     -> "Menunggu Verifikasi"
Guru Piket         -> verifikasi    |  verifikasiIzinKeluar -> "Sedang di Luar" / "Pulang"
siswa kembali                       |  tandaiKembaliIzinKeluar -> "Kembali"
penutupan                           |  selesaikanIzinKeluar -> "Selesai"
```

`Waktu_Keluar` is stamped at **verification**, never at approval — one approval
is never treated as the whole procedure.

Five statuses, no overlap: `Menunggu Verifikasi`, `Sedang di Luar`, `Kembali`,
`Pulang`, `Selesai`. **The client never sends a status.** It calls an action;
the server derives the next status from the row's *current* status plus the
stored `tujuan`, so an impossible order (Pulang then Kembali, Kembali twice,
anything at all on a `Selesai` row) is rejected server-side. The UI's three
buckets (Menunggu Verifikasi / Sedang di Luar / Selesai Hari Ini) are a
*grouping* of those five, not a second status model.

Who may do what — **all of it re-checked server-side in `canVerifyIzin()`**
(`Utils.gs`), with hidden buttons never being the gate:

- **approve** (`addIzinKeluar`, jalur normal) → any non-OSIS teacher, recorded
  as *"guru yang memberikan persetujuan"*. This system deliberately holds **no
  teaching-schedule data** and none will be added for this feature — the real
  timetable changes at short notice, so "the teacher of that hour" is not
  provable from anything SIGAP has. What gets recorded is *who* approved
  (name + id from the **session**) and *when*, nothing more. Don't invent a
  schedule sheet/mapping/endpoint, don't add a role, and don't ask the client
  to send a role claim ("I'm the wali kelas / the teacher of this hour") — an
  unverifiable claim only buys false confidence. The UI says the plain truth
  instead: "Anda akan tercatat sebagai pihak yang memberikan persetujuan izin
  ini.
- **verify / mark returned / close** → the Guru Piket **on duty today**, read
  from the existing `Jadwal_Piket` sheet, plus admin/BK (also the fallback
  when `Jadwal_Piket` is empty, otherwise nobody could verify at all).
  Re-evaluated *per action*, so a shift change on the same day just works and
  whoever marks a student back need not be who approved or verified.
- **Izin Khusus** (`jalur: 'khusus'`) → same authority as verify, and the
  `Alasan_Khusus` is mandatory. It does **not** forge anyone else's
  approval: `Disetujui_Oleh` holds the piket teacher's own name, `Jalur` is
  stamped `khusus`, and an exception reason sent on a *normal* row is
  discarded so a normal row can never read as an exception.

Integrity: `resolveSiswaForIzin()` takes name/class from `Master_Siswa` (the
client only picks *who* via NISN) — the client's `class_name` is never stored,
so it can't be used to steer the read scope; and a student with an open
transaction (`Menunggu Verifikasi`/`Sedang di Luar`) cannot get a second one,
which is what makes a double-tapped Simpan harmless. Rows are addressed by
`ID_Izin`, never by row number.

Read scope (`scopeIzinForUser`) **does not widen anyone's access**: rows still
*running* are visible to every non-OSIS user — same justification as
"keterlambatan & surat hari ini is school-wide", the piket on duty must see who
is still outside — and everything closed falls back to the existing
`scopeDailyRecordsForUser()` rule. OSIS is rejected outright.

Riwayat gets an `izin` category that is **read-only**: izin has its own status
flow in Gerbang, it does not go through `editEntry`/`deleteEntry`, and
`getSheetForCategory()` deliberately doesn't know the category so a hand-rolled
edit/delete request is rejected too.

#### Izin Kelompok (one activity, many students)

Built **on top of** the individual flow, not beside it. One activity row in the
new `Izin_Kelompok` sheet (15 cols) is the parent; each participant is an
ordinary `Izin_Keluar` row carrying the parent's id in `ID_Kelompok` — the
**21st column, appended at the end** so no existing column shifted.

```
Izin_Kelompok  (1 row = 1 ACTIVITY: kegiatan, tujuan, pola kembali, approver)
       |
       +--> Izin_Keluar (1 row = 1 STUDENT: its own status, its own transitions)
```

**The activity sheet deliberately has no status column.** Every participant
keeps an individual status, and the group's state ("8 siswa · 7 di luar · 1
kembali") is always *computed* from the member rows (`ringkasKelompok()` in
`Utils.gs`, `ringkasPesertaKelompok()` in `gerbang.js`). Don't add a group
status — two sources of truth would let one student who never came back hide
behind a green rombongan.

Group actions are batch operations over member rows, never a second state
machine: `addIzinKelompok`, `verifikasiIzinKelompok`, `tandaiKembaliKelompok`.
Each member is still validated one by one with the same guards as the
per-student actions, so a mass action can't be used to slip past a transition
rule. Pola `individual` needs no group action at all — it reuses
`tandaiKembaliIzinKeluar` per student.

Rules that are easy to break and are pinned by `tests/izin-kelompok.test.js`:

- **All-or-nothing creation.** Every participant is resolved and checked before
  a single row is written; one unknown NISN or one student with an open
  transaction rejects the whole submission. A half-saved group reads as
  legitimate while the teacher thinks it failed.
- **`tandaiKembaliKelompok` requires an explicit `pesertaIds` list.** There is
  no "mark all" path: unchecked members stay `Sedang di Luar`, and the
  difference is written to the Audit Log by name. `verifikasiIzinKelompok`'s
  `pesertaIds` is optional but may only *narrow* — an id from another activity
  is rejected, not ignored.
- **Client sends only NISNs.** Names and classes come from `Master_Siswa`
  (`resolveSiswaListForIzin`, one read for the whole list), duplicates are
  dropped, and `IZIN_MAX_PESERTA` caps how many rows one request can write
  while holding the global script lock.

One transition was **added** to the individual state machine for this:
`tandaiPulangIzinKeluar` moves `Sedang di Luar → Pulang` for a student who
turns out not to be coming back (a seminar participant who goes straight home).
Without it that row would hang at `Sedang di Luar` forever. Nothing was
loosened: it still requires piket authority, still only works from `Sedang di
Luar`, and `Pulang` still refuses `tandaiKembali`.

Read scope adds no new rule: activities are returned only when at least one of
their members is already visible under `scopeIzinForUser`, and the activity
name is attached to member objects **at send time** (never duplicated into the
student rows), so Riwayat can show "Seminar Bank Indonesia — …" without a
second scoping path that could drift.

**Printing: nothing is decided.** Printer model, connection method, media,
paper/slip size, layout and output format are all still open, so the BETA is
digital-only. The single sentence the UI is allowed to say is "Fitur pencetakan
masih dalam tahap BETA." Don't add a paper size, a layout, a protocol, or any
device assumption (Bluetooth/Wi-Fi/USB/AirPrint/ESC-POS) — and if printing is
ever added it is an *output of a saved row*: a transaction must never depend on
printing succeeding. `tests/izin-keluar-frontend.test.js` fails the build if
such an assumption appears.

### Export Data: who may export what

`exportData` (a `doGet` action) is the only path that hands a report file's
contents to the browser. Google Sheets stays admin-only; this replaces
"just give the teacher access to the Sheet".

- admin / bk_kesiswaan → every report type, any class (or all classes)
- **guru who is a wali kelas** → their own class only, and **not** Bimbingan
  Khusus (that one stays admin/BK-only, mirroring `getBimbingan`)
- plain guru (not a wali kelas) → no export at all. There is no teaching-schedule
  mapping in this system, so there is no data-backed way to give them a class
  scope — don't invent one to make the feature easier.
- osis → rejected

Enforcement lives in `resolveExportAccess()` (Utils.gs), not in the menus: the
client's `kelas` parameter is never trusted — a wali kelas asking for another
class is **rejected**, not silently corrected. The handler order in `Code.gs`
is load-bearing and asserted by `tests/export-backend.test.js`: session →
export rate limit → authorization → filter validation → *only then* read
sheets. Report columns are fixed per report type in `EXPORT_JENIS` (Utils.gs);
users pick a report, never columns. NISN, `Foto_URL`, and `Dicatat_Oleh_ID`
are deliberately excluded from every export (Rekap Siswa still *groups* by
NISN — duplicate student names must not merge — it just doesn't emit it).
Every attempt, successful or rejected, is written to `Audit_Log` with
metadata only (jenis/periode/cakupan/format/row count/status) — never student
names or note contents.

`getAuditLog` is **admin-only** (`isAdminRole`). It used to be admin +
BK/Kesiswaan (`isBkRole`); it was tightened when export landed, because the
Audit Log now also carries every export attempt — it is an oversight trail over
*everyone*, including admins, not a day-to-day BK tool. The gate is the role
check in `Code.gs`; dropping `'auditlog'` from `bk_kesiswaan` in `config.js`
(and the `roleKey !== 'admin'` guard in `fetchAuditLog`) only stops a request
that would now be rejected anyway.

### Tests

`tests/render-smoke.test.js` renders each top-level tab component with a
fake `React`/`document`/`fetch` shim (no jsdom) and asserts it doesn't throw —
this is where real render bugs typically surface, per its own header comment.
It requires `@babel/core` (a devDependency) to transform JSX before running.
`tests/password.test.js` covers the hashing/migration logic in `Utils.gs`/`Auth.gs`.
`tests/export-backend.test.js` loads `Utils.gs`+`Auth.gs`+`Code.gs` into a vm with
stubbed Apps Script services and calls `doGet()` for real — that's where export
authorization, scope tampering, filter validation, and audit logging are pinned
down. `tests/export-frontend.test.js` covers the PDF/XLSX writers byte-for-byte
plus the Export tab's UI gating.
`tests/izin-keluar.test.js` drives the whole Izin Keluar workflow through the
real `doPost`/`doGet` (approve → verify → return → close, both jalur, every
invalid transition, double submit, parameter tampering, audit trail and read
scope); `tests/izin-keluar-frontend.test.js` covers its client wiring and is
also what pins down "no printer assumptions".
`tests/izin-kelompok.test.js` does the same for Izin Kelompok (all-or-nothing
creation, partial verification, rombongan return with a student left outside,
one member going home while the rest return, cross-activity id tampering, and
that the individual flow still works beside it).
