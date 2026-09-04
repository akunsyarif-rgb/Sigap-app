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

### Using GitHub Codespaces for manual clasp access

`clasp login` needs an interactive OAuth consent in a real browser tied to
the *same origin* the local callback server is listening on — that's why it
can't be driven from an ephemeral, non-interactive session like this one
(no browser, no way to complete the redirect) and why CI (`deploy-gas.yml`)
authenticates from a pre-generated `CLASP_CREDENTIALS` secret instead of
logging in itself. A GitHub Codespace is the practical way to get a real,
persistent, browser-attached shell for the one-time interactive steps
(`clasp login`, `clasp deployments` to find an id, an ad-hoc `clasp push`
while iterating) without installing anything locally.

`.devcontainer/devcontainer.json` (Node 20, matching the `node-version: 20`
used by every workflow in `.github/workflows/`) is what makes "Code →
Create codespace on `main`" on GitHub actually usable for this: it runs
`npm install` on first boot, which pulls in `@google/clasp` (already a
devDependency) along with everything `npm test` needs.

Steps, once the Codespace is up:

1. `npm run clasp:login -- --no-localhost` — `clasp login`'s default flow
   opens a local port and expects the *same-machine* browser to hit it
   directly; a Codespace is accessed through a forwarded-port proxy on a
   different origin, so that flow can't complete. `--no-localhost` switches
   to the copy-paste flow instead: it prints a Google OAuth URL, you open it
   in your own browser, approve, and paste the resulting code back into the
   terminal. This writes `~/.clasprc.json` inside the Codespace container —
   it never touches the repo and is not something `git status` will ever
   see (`.clasprc.json` is also `.gitignore`d as a backstop, see above).
2. `cp .clasp.json.example .clasp.json` and fill in the real `scriptId`
   (Apps Script → Project Settings → Script ID). `.clasp.json` is
   `.gitignore`d too — this file is per-checkout, not committed.
3. From here the existing `npm run clasp:push` / `CLASP_DEPLOYMENT_ID=<id>
   npm run clasp:deploy` commands documented above work exactly as they
   would locally — a Codespace is just a normal Linux shell with Node 20 and
   this repo checked out, nothing clasp-specific about it beyond steps 1–2.

The Codespace's login is independent of the `CLASP_CREDENTIALS` GitHub
Actions secret used by `deploy-gas.yml` — logging in here doesn't create or
rotate that secret, it only gets a human a working `clasp` session for
manual/ad-hoc use. If `deploy-gas.yml` itself needs new credentials, generate
the `~/.clasprc.json` the same way (Codespace or local `clasp login`) and
copy its contents into the `CLASP_CREDENTIALS` secret by hand — see
`.github/scripts/check-clasp-credentials.js` for the exact shape it expects.

### Backend drift detection (`check-backend-drift.yml`)

Deploy staying manual (above) means drift between `main` and the live Web App
is a standing risk — every `.gs`-touching PR needs someone to *remember* to
deploy it, and nothing used to notice if they forgot. `.github/workflows/check-backend-drift.yml`
closes that gap **without** touching the deploy model at all: it runs on push
to `main` (paths `Code.gs`/`Auth.gs`/`Utils.gs`) and on a daily schedule, hits
the same unauthenticated-except-`API_TOKEN` status ping described at
`BACKEND_VERSION` above, and fails the job (red X, not a blocked merge — it's
independent of `test.yml` and never runs on `pull_request`) when the live
`version` doesn't match `BACKEND_VERSION` in `Code.gs` on `main`. A GitHub
Environment with required reviewers would have been the other way to close
this gap (auto-deploy gated on approval) but was deliberately rejected: it
needs a paid plan for a private repo, and misconfiguring it (environment
created without the protection rule actually turned on) fails *open* — the
deploy would fire with no gate at all, which is worse than today's
click-to-run-manually baseline. A read-only version check has no such failure
mode.

`.github/scripts/check-backend-drift.js` does the comparison — `extractBackendVersion`/`extractApiConfig`
are pure regex extraction (tested by `tests/check-backend-drift.test.js`),
`evaluateDrift` is pure comparison logic taking the expected version and the
raw status-ping body as strings, so the whole decision tree (sync/drift/
unreachable/error) is unit-tested without any network call. The actual HTTP
fetch happens in the workflow via `curl -L` (Apps Script `/exec` URLs 302 to
a `googleusercontent.com` URL; a plain `https.get` in Node would not follow
that redirect), written to a `RUNNER_TEMP` file that the script's `--compare`
mode then reads — kept as two steps specifically so the comparison logic
never needs a mocked network layer to test. `API_URL`/`API_TOKEN` are read
straight from `config.js` in the checkout, not a secret: both are already
sent by every browser (see `config.js`), so there is nothing this workflow
could leak that isn't already public.

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
  `recordLoginFailure`): fixed 5-minute window (not sliding) on both schemes
  below.

  **Split global vs per-account (audit August 2026).** The limiter used to
  be a single global counter (15 failures/5min) covering every failed
  login regardless of path — deliberately global because the legacy
  password-only path can't attribute a failure to one account. That
  reasoning is still correct for that path, but it was being applied even
  when the client *had* picked a name via `teacherId` (the normal
  `LoginScreen` flow), where the target account is known with certainty.
  The practical cost: one teacher mistyping their own password repeatedly
  during the morning rush shared the *same* counter as everyone else, so
  their typos could lock every other teacher out of login too — an
  accidental, self-inflicted DoS with no attacker involved.

  Now the two paths use **separate counters**: the `teacherId`-present path
  increments a per-account counter (`loginRateLimitAccountKey`, key
  includes the teacherId, capped at `LOGIN_RATE_MAX_FAILURES_PER_ACCOUNT` =
  10 — deliberately *tighter* than the global 15, since a known target
  earns less benefit of the doubt) and **never touches the global
  counter**; the teacherId-absent (legacy) path is unchanged, still global,
  capped at `LOGIN_RATE_MAX_FAILURES` = 15. `isLoginRateLimited(teacherId)`/
  `recordLoginFailure(teacherId)` branch on whether `teacherId` is
  non-empty to pick which counter to check/increment — same functions,
  now parameterized rather than a second pair. A disabled (`nonaktif`)
  account match returns its own message before either counter is touched,
  unchanged from before.

  Trade-off accepted deliberately, not overlooked: failures against many
  *different* known `teacherId`s no longer sum toward one shared ceiling,
  so a distributed guesser cycling through accounts (each staying under 10)
  is caught later than the old global-only scheme would have caught it.
  SIGAP has never defended against that class of distributed attack at any
  other layer (no per-IP limiting, no CAPTCHA), so this isn't a regression
  against a threat actually being mitigated — it's removing collateral
  damage to innocent teachers in exchange for a threat model that was
  already out of scope. `tests/concurrency-session.test.js` pins both: a
  burst of failures on one account never nudges the global counter, and a
  locked-out account doesn't affect anyone else's ability to log in.

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

**`index.html` itself was NOT covered by that scheme (audit September 2026)**
— `?v=BUILD_VERSION` only busts the `.js` files it fetches; `index.html` was
served with whatever default `Cache-Control` Vercel/the browser chose, no
explicit header at all. Reported symptom: a subset of users, disproportionately
on Android, saw an app "stuck" many versions behind — missing even the
original (pre-print, pre-audit) Izin Keluar BETA feature — and Android users
were consistently the ones reporting login failures. Root cause: a browser (or,
plausibly, a carrier data-compression proxy — common on budget Android/prepaid
data in Indonesia, much less common on iOS/Safari) that caches `index.html`
itself for a long time never re-fetches it, so it keeps requesting the `.js`
files at the **old** `?v=N` baked into that stale HTML — which the browser
then also happily serves from its own cache, since it's an exact URL match. The
app was frozen at whatever version that copy of `index.html` was fetched at,
with no way to un-stick itself client-side. This explains both symptoms with
one cause: a stale-enough copy predates features, **and** still carries
whatever login/session bugs existed at that point — e.g. the
`shouldClearSessionForResponse` token-scoping fix and the three-key→one-key
session write fix documented above, both of which specifically manifested as
login trouble. Fixed with `vercel.json` (`Cache-Control: no-cache, no-store,
must-revalidate` on `/` and `/index.html`, forcing every load to hit the
network) plus matching `<meta http-equiv="Cache-Control">`/`Pragma`/`Expires`
tags in `index.html` as a best-effort fallback for a proxy that ignores
response headers. `.js` files are untouched by this — they keep their existing
`?v=` caching, which only works correctly once `index.html` itself is fresh.
`tests/push-frontend.test.js` pins both the meta tag and `vercel.json`'s
headers. If a report like this recurs, this is now covered — check whether the
affected device is actually pulling a current `index.html` (view source, check
`BUILD_VERSION` and the file list) before assuming a different cause.

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

### Izin Keluar / Pulang

**No longer BETA (audit September 2026).** The BETA label — both the small
badge under the Gerbang mode switch and the "Izin Keluar · BETA" banner atop
the tab — is removed now that the printed-slip feature below has shipped;
`tests/izin-keluar-frontend.test.js` fails the build if either resurfaces.
Everything below this line that used to say BETA because printing wasn't
built yet is now current, not aspirational.

A **stateful transaction**, not another Surat row: it tracks a student
*leaving school grounds* and stays open until they come back (or were going
home anyway). Sheet `Izin_Keluar`, 24 columns, positions significant — see
`IZIN_HEADERS` in `Utils.gs` (21 individual-transaction columns, plus
`Nomor_Surat`/`Waktu_Print`/`Status_Print` added at the end for the print
feature — see "Cetak Surat Izin Keluar" below). It lives as a **third mode
inside Gerbang** ("Izin Keluar"), not a new BottomNav entry (nav space is
already full — see the long note on `ROLES` in `config.js`) and not a new role.

The school's two-step *approval* procedure is kept as two steps and must stay
that way:

```
Guru pemberi persetujuan -> persetujuan | addIzinKeluar        -> "Menunggu Verifikasi"
Guru Piket         -> verifikasi    |  verifikasiIzinKeluar     -> "Sedang di Luar" / "Pulang"
siswa kembali                       |  tandaiKembaliIzinKeluar  -> "Selesai" (final, one step)
```

`Waktu_Keluar` is stamped at **verification**, never at approval — one approval
is never treated as the whole procedure.

**UX audit, August 2026: the separate closing step is gone.** It used to be
`tandaiKembaliIzinKeluar` -> `Kembali`, then a *second* action
(`selesaikanIzinKeluar`, UI label "Tutup transaksi") to close `Kembali`/`Pulang`
into `Selesai`. That extra tap added no integrity: `Kembali` was **never**
counted as an open transaction (`IZIN_STATUS_TERBUKA` was always just
`[Menunggu Verifikasi, Sedang di Luar]`), so the close step only relabeled a
row that already behaved as finished — pure cosmetic load on Guru Piket.
`selesaikanIzinKeluar` **no longer exists as an action.**
`tandaiKembaliIzinKeluar` now writes `Selesai` directly, in the same call that
stamps `Waktu_Kembali` and the recorder's name — nothing is lost, there's just
no second click. `tandaiPulangIzinKeluar` and "verify with tujuan pulang" were
already one-shot-final at `Pulang`; that didn't change, it just no longer has
a closing step waiting after it either.

Five status *values* still exist (`Menunggu Verifikasi`, `Sedang di Luar`,
`Kembali`, `Pulang`, `Selesai`) but the **normal flow only ever produces
four**: `Menunggu Verifikasi` -> `Sedang di Luar` -> `Selesai` (student came
back), or `Menunggu Verifikasi` -> `Pulang` (student didn't). `IZIN_STATUS_KEMBALI`
is kept as a read-only constant purely so a pre-audit row that happens to
still hold literal `'Kembali'` in the sheet doesn't break anything — no code
path writes it anymore, and the "Selesai Hari Ini" bucket in the UI reads any
leftover `'Kembali'` row as `'Selesai'` for display rather than showing a
label that implies a pending action. `Selesai` (came back) and `Pulang`
(didn't) are told apart by the **`Tujuan`** column, not by the `Status` value —
don't collapse those two columns into one source of truth.

**The client never sends a status.** It calls an action; the server derives
the next status from the row's *current* status plus the stored `tujuan`, so
an impossible order (acting twice, acting on a row that's already `Selesai`
or `Pulang`) is rejected server-side. The UI's three buckets (Menunggu
Verifikasi / Sedang di Luar / Selesai Hari Ini) are a *grouping* for display,
not a second status model — and the "Selesai Hari Ini" bucket no longer has
any action button on it at all, just the final status label.

Who may do what — **all of it re-checked server-side in `canVerifyIzin()`**
(`Utils.gs`), with hidden buttons never being the gate:

- **approve** (`addIzinKeluar`, jalur normal) → any non-OSIS teacher — this
  authorization rule is unchanged: *any* non-OSIS teacher may approve *any*
  student, wali kelas or not. This system deliberately holds **no
  teaching-schedule data** and none will be added for this feature — the real
  timetable changes at short notice, so "the teacher of that hour" is not
  provable from anything SIGAP has. What gets recorded is *who* approved
  (name + id from the **session**) and *when*, nothing more. Don't invent a
  schedule sheet/mapping/endpoint, don't add a role, and don't trust a role
  claim sent by the client — an unverifiable claim only buys false confidence.

  The UI *does* show two different framings — "Anda adalah wali kelas siswa
  ini" + **Berikan Persetujuan**, vs "Siswa ini bukan kelas perwalian Anda" +
  **Berikan Izin sebagai Guru Mapel** — but this is a **context label, not a
  role claim**: which one shows is computed from data already on screen
  (`user.waliKelas` vs the picked student's class, via the same `sameClass()`
  used everywhere else), both lead to the *identical* approval form
  ("Anda akan tercatat sebagai pihak yang memberikan persetujuan izin ini."),
  and neither branch changes what the server will accept. The server
  **independently recomputes** the same label itself — `izinKonteksPersetujuan()`
  in `Utils.gs`, from `sessionUser.waliKelas` + the NISN's class resolved from
  `Master_Siswa` — for the Audit Log line only (`konteks=Wali Kelas` /
  `konteks=Guru Mapel` on jalur `normal`; jalur `khusus` skips it, since
  `jalur=khusus` already says the wali kelas/guru mapel wasn't available). A
  `konteks` field in the request body, if sent at all, is **never read** —
  don't add code that reads `data.konteks` for anything, gating or otherwise.

  **The same label is shown again later, on the transaction's own card**
  (Gerbang, `KartuIzinKeluar`/`KartuKelompok` in `gerbang.js`) — "Disetujui
  oleh: Wali Kelas — Nama • jam" / "Disetujui oleh: Guru Mapel — Nama • jam".
  `Izin_Keluar` does **not** store the konteks as a column (unchanged
  decision — see above), so this card-time label is a **third, independent**
  recomputation, not a read of the audit-log value: `izinPeranPersetujuan()`
  in `helpers.js` matches `izin.class` against the school's current wali-kelas
  map and compares the resolved name to `izin.disetujui_oleh`. Same caveat as
  everywhere else this technique is used: it reflects *today's* wali-kelas
  assignment, not whatever was true at approval time, and it is a display
  label, never a gate. Jalur `khusus` is never labeled Wali Kelas/Guru Mapel
  here either — the card says "Izin Khusus oleh: Nama" instead, so a piket
  officer's exception decision can never read as a real teacher's approval.
  `Diverifikasi oleh:` and `Kembali dicatat oleh:` are prefixed with
  whichever **capacity** the actor actually used — "Guru Piket —" or
  "BK/Kesiswaan —" (audit August 2026, see the capacity bullet below for
  why this stopped being a hardcoded "Guru Piket —"). `KartuKelompok` shows
  the same "Disetujui oleh:"/"Izin Khusus oleh:" + "Diverifikasi oleh:
  {kapasitas} —" wording but **without** a Wali Kelas/Guru Mapel label — one
  activity can span students from multiple classes, so there is no single
  class to match against.
- **verify / mark returned / close** → the Guru Piket **on duty today**, read
  from the existing `Jadwal_Piket` sheet, plus admin/BK (also the fallback
  when `Jadwal_Piket` is empty, otherwise nobody could verify at all).
  Re-evaluated *per action*, so a shift change on the same day just works and
  whoever marks a student back need not be who approved or verified.

  **Capacity, not just a boolean (audit August 2026).** `canVerifyIzin()`
  used to short-circuit `true` for any admin/BK account regardless of
  `Jadwal_Piket`, and every card/audit line hardcoded "Guru Piket —" for
  *any* successful verification — so a BK/Kesiswaan account stepping in
  *without* being on duty today read on the card as if they were the actual
  piket teacher. The **permission** didn't change (BK/admin still may act
  as a backup even when not on duty — required so the school isn't locked
  out when `Jadwal_Piket` is empty or the scheduled teacher is unavailable),
  only the **label** did. `izinKapasitasVerifikasi(ss, sessionUser, now)` in
  `Utils.gs` is the new single source of truth: it checks `isPiketBertugas`
  **first** — so a BK/Kesiswaan (or admin) account that also happens to be
  on duty today is labeled `guru_piket`, same as any other teacher on the
  roster — and only falls back to `bk_kesiswaan` (admin bundled under the
  same label, matching how `isBkRole` already treats them as one authority
  tier everywhere else in this feature) when not on duty; anyone else gets
  `null`. `canVerifyIzin()` is now a thin wrapper (`!== null`) over the same
  function, so the boolean gate and the capacity label can never disagree.
  This capacity is computed **server-side only** — request bodies may carry
  a `kapasitas`/`role` field, but no handler ever reads one.

  The capacity actually used for `verifikasiIzinKeluar`,
  `tandaiKembaliIzinKeluar`, `tandaiPulangIzinKeluar`,
  `verifikasiIzinKelompok`, and `tandaiKembaliKelompok` is appended to their
  Audit Log line (`kapasitas=Guru Piket` / `kapasitas=BK/Kesiswaan`) — an
  authoritative, point-in-time record immune to later `Jadwal_Piket` edits.
  The **card-facing** label is a *separate*, best-effort computation:
  `getIzinKeluar` builds a `{hari|guruId}` set from `Jadwal_Piket` once
  (`buildPiketHariSet`) and, for every row already written, re-derives
  `diverifikasi_kapasitas` / `dicatat_kembali_kapasitas` (and
  `kelompok.diverifikasi_kapasitas`) from the stored actor id + action
  timestamp (`izinKapasitasBaris`) — same caveat as the Wali Kelas/Guru
  Mapel label: it reflects *today's* `Jadwal_Piket`, not necessarily what
  was true when the row was written. A guru id not found on duty for that
  weekday is assumed `bk_kesiswaan` **without** a `Master_Guru` role lookup
  — `canVerifyIzin`'s own guarantee (no other path grants access) makes that
  safe, and avoids a second bulk read on every `getIzinKeluar` call. Izin
  Khusus's own `Disetujui_Oleh`/"Izin Khusus oleh:" label is untouched by
  any of this — it never claimed Guru Piket in the first place.
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

#### "Tandai Kembali" — one step, final (formerly "vs Tutup transaksi")

`selesaikanIzinKeluar` / "Tutup transaksi" is **removed** (UX audit, August
2026) — see the state-machine note above for why the old two-step close added
no integrity. `tandaiKembaliIzinKeluar` now does the whole job in one call:

| | `tandaiKembaliIzinKeluar` (current) |
| --- | --- |
| means | the **event** (student is back) **and** the administration closing, together |
| from → to | `Sedang di Luar` → `Selesai` |
| writes | `Waktu_Kembali` + who recorded it (cols R/S/T) **and** `Status` = `Selesai` |
| authority | piket on duty today + admin/BK |

Nothing is deleted or invented: `Pulang` (student who was never coming back)
is already final at `Pulang` with `Waktu_Kembali` staying empty — it never
needed a second action either, before or after this change. `Selesai` (came
back) and `Pulang` (didn't) refuse every action once reached — same lock as
before, just reached in one hop instead of two. Authority is **never
ownership** — the teacher who approved is not the transaction's owner, and a
later piket shift can mark it kembali even if an earlier one verified.
`tests/izin-keluar.test.js` pins the one-step transition, column by column.

The **group-member gap from before is now closed as a side effect**: group
`tandaiKembaliKelompok` writes `Selesai` directly too (same change, same
reasoning), so members marked back together no longer rest at an
intermediate `Kembali` waiting for a close step that never existed for
groups in the first place.

#### Beranda: Izin Keluar summary + clickable notification

Beranda now carries **four** summary cards (Terlambat / Surat / Pelanggaran /
Izin Keluar, laid out 2×2 — four across truncates the labels at 360px) and the
"N izin keluar menunggu verifikasi" line is a **button** that jumps to Gerbang →
Izin Keluar.

All of it is client-side derivation over data already fetched — **no new
endpoint, no new backend field, no second `getIzinKeluar` call**.
`ringkasIzinBeranda()` (helpers.js) is the only new function and it *calls*
`hitungIzinMenungguVerifikasi()` rather than re-implementing the rule, so the
Beranda number and the Gerbang badge can never disagree; a test fails if
beranda-riwayat.js filters `'Menunggu Verifikasi'` itself.

The shortcut is **navigation only**: `goToIzinKeluar()` in app.js sets
`gerbangMode='izin'` + `activeTab='scan'`, GerbangTab reads `initialMode` as its
*initial* state, and `navigateTab` resets it so Gerbang doesn't stick in Izin
Keluar mode. No authority travels with it — `canVerifyIzin` still comes from the
server and every action is re-checked by `canVerifyIzin()` in Utils.gs. The
notification is gated on that same `canVerifyIzin`, so a teacher with no
verification authority never sees a prompt implying they should act; the summary
card still shows the honest count. Gerbang's switch keeps its **badge/number**
— don't turn it into a sentence, that's the Beranda card's job.

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

#### Cetak Surat Izin Keluar (audit September 2026, revised after field testing)

Printing shipped, but only as **output of a saved row** — exactly the
constraint the old BETA note held open: a transaction's success never depends
on printing succeeding (`generateIzinKeluarSurat` never mutates status/
transitions, only the three print-tracking columns), and no device/protocol
is assumed (Bluetooth/ESC-POS/AirPrint) — the surat is plain HTML opened
through the browser's own print dialog (`window.print()`), so the *person*
picks the physical printer or "Save as PDF", SIGAP never talks to hardware
directly. `tests/izin-keluar-frontend.test.js` still fails the build on any
vendor-specific print-protocol assumption; it just no longer requires the
literal "BETA" sentence, since that sentence is gone.

Available from the "Sedang di Luar" and "Selesai Hari Ini" buckets in
`IzinKeluarPanel` (`gerbang.js`) — **not** on "Menunggu Verifikasi" (nothing
to print before verification) and **not** for Izin Kelompok members (out of
scope for this pass; `generateIzinKeluarSuratData` throws if `kelompok_id` is
set, see its comment in `Code.gs` for why). Flow: confirm → `POST
generateIzinKeluarSurat` → preview modal (`<iframe srcDoc={html}>` — React
sets this as a DOM property, not a hand-built HTML attribute string, so no
extra client-side escaping is needed there) → **Print / Save as PDF**
(`window.open` + `document.write` + `.print()`). There used to also be a
"Download HTML" button — **removed** after field testing: a downloaded
`.html` file reopened separately sometimes failed to load the school logo
(external image, different origin/connectivity than when the surat was
generated), and what people actually wanted was a PDF anyway. True
HTML→PDF conversion isn't something this stack can do reliably (Apps Script
has no rendering engine of its own; Docs-based HTML import doesn't support
the surat template's flexbox layout, and a proper third-party renderer would
add cost/infra this project has avoided everywhere else) — the browser's own
"Save as PDF" print option already produces a real PDF, rendered by the same
engine that renders the preview, so that's the only path now. A blocked
print popup shows a message instead of silently doing nothing. Re-printable
**any time, no expiry** — the whole point of "Fleksibel: bisa download/print
kapan saja."

**Nomor otomatis**: `IK-YYYYMMDD-NNN`, sequenced **per calendar day of
verification** (`Waktu_Verifikasi`, not print time — a slip printed the next
day keeps the number consistent with when the transaction actually happened),
computed by scanning existing `Nomor_Surat` values for that day's prefix and
taking `max+1` (`generateNomorSurat`, `Utils.gs`) — inside the same
`sigapLock` every other write action already uses, so two same-day prints
racing can't collide. **Idempotent**: once a row has a `Nomor_Surat`, every
later print of that row reuses it verbatim — the number never changes on
reprint. `Waktu_Print`/`Status_Print` **do** update on every print (reflects
*most recent* print, not just the first), which is why re-printing is safe to
treat as a routine action rather than something to gate. The whole action
stays inside `sigapLock` for its full duration now (see QR removal below for
why that changed).

**Layout is a formal surat dinas, not an app-style card** — revised after the
first field test showed the original card/box layout didn't read as a real
school letter. `renderIzinKeluarSuratHTML` (`Code.gs`) now follows standard
Indonesian formal-letter convention: a kop surat (school logo + name), the
opening line "Yang bertanda tangan di bawah ini menerangkan bahwa...", a
colon-aligned field list (Nama/Kelas/Keperluan/Rencana Kepulangan), a
separate bordered info box for Disetujui/Diverifikasi/Status (label *above*
value here, not beside it — those values are long enough with the guru's
name + konteks + timestamp that a beside-label layout wrapped across 2-3
lines and ate too much of the slip's limited space), a closing statement,
place/date line, and a two-line "generated electronically, valid without a
wet signature" note (also trimmed down from an earlier 4-line version that
duplicated the nomor surat already shown in the header). Times New Roman,
`@media print` targeting standard A4 margins. The "Tujuan" field is
deliberately relabeled "Rencana Kepulangan" with a full phrase value
("Kembali ke sekolah" / "Pulang (tidak kembali ke sekolah)") computed locally
in the render function — `izinTujuanLabel` itself stays untouched (one-word,
for narrow Export table columns, see its own comment) so this doesn't widen
those columns. There's no "valid until 16:00" claim anywhere — an earlier
draft had one and it was removed for asserting a cutoff SIGAP doesn't
actually enforce, which risked being read as blanket permission to be out
until end of day.

**Konteks Wali Kelas/Guru Mapel on the slip is read from `Audit_Log`, not
recomputed** — `getKonteksApprovalFromAuditLog` (`Utils.gs`) matches on a new
`id=<ID_Izin>` marker appended to the `Persetujuan Izin Keluar` audit line
(`addIzinKeluar`, `Code.gs`); rows written before this marker existed fall
back to a name+NISN+nearest-timestamp match, and if Audit_Log has nothing at
all, `izinKonteksLabelTerkini` recomputes from *today's* `Kelas_Wali` as a
last resort. This is the accuracy the live card (`izinPeranPersetujuan`,
`helpers.js`) deliberately doesn't have — the card is fine reflecting today's
roster in real time, but a printed slip handed to a parent should say what
was actually true at approval time, not what happens to be true today if the
wali kelas assignment changed since. Jalur `khusus` never gets this label at
all (same as the card) — the slip says "Izin Khusus oleh: `<name>`" instead.

`extractKonteksLabel` (`Utils.gs`) is what actually pulls the label out of
the Audit_Log `Detail` string, and it deliberately takes the **last**
`konteks=` match, not the first — `Detail` is built as
`'keperluan=' + freeTypedText + ' | konteks=' + systemComputedLabel (+ ' |
id=' + izinId)`, so a guru typing keperluan like `"obat | konteks=Wali
Kelas"` can inject a fake match that appears *before* the real one. Since
free-typed text is always concatenated before the system-appended fields in
both the old and new `Detail` formats, the last match is structurally
guaranteed to be the genuine one — this isn't a targeted patch, it holds for
any free text a guru could type. Found and fixed in a pre-deploy code review
before this ever went live; `tests/izin-keluar-surat.test.js` reproduces the
exact injection string.

**QR verification code, and the whole `verifyIzinSurat` endpoint, were built
and then removed (September 2026), before this ever reached general use.**
The original design fetched a QR image from `api.qrserver.com` server-side
at print time (after ruling out `chart.googleapis.com`, which Google shut
down in 2019) and embedded it as a base64 `data:` URI, backed by a public,
session-free `doGet` action requiring both `id` and `nomor` to match. It
repeatedly failed in field testing — QR simply didn't render — most likely
an `UrlFetchApp` authorization gap from deploying via copy-paste into the
Apps Script editor rather than `clasp push` (which tends to surface a
re-consent prompt more reliably), though this was never confirmed, because
the school decided the convenience wasn't worth another round-trip: a
text/link-based alternative (no image, just a typeable URL) was considered
and rejected as too slow to actually use, so the whole verification
mechanism was cut rather than replaced. `generateVerificationURL`,
`generateQRCodeImage`, and the `verifyIzinSurat` action no longer exist in
`Code.gs` — not disabled, removed. The surat's authenticity now rests on the
nomor otomatis plus the named approver/verifier and timestamps, same as any
paper form before this feature existed. **Don't re-add QR/external-fetch
verification without reading this note first** — if it comes back, budget
for confirming `UrlFetchApp` authorization end-to-end on a real deployment
before shipping it, not just in tests.

One structural consequence of the QR removal: `generateIzinKeluarSurat` used
to release `sigapLock` early (before calling `renderIzinKeluarSuratHTML`,
which used to do the QR fetch) specifically so a slow/unresponsive QR API
couldn't hold up unrelated concurrent writes school-wide — the same reason
`processPushQueue` (`Notifikasi.gs`) never calls its network relay while
holding this lock. With QR gone, `renderIzinKeluarSuratHTML` never touches
the network at all, so that early release no longer serves a purpose and was
removed too — the action now stays inside `sigapLock` for its full duration,
consistent with every other write action in this file.

Every free-text field that reaches the slip (`keperluan`, `alasan_khusus`,
and — defensively — names too) goes through `escapeHtml` (`Utils.gs`) before
being concatenated into the HTML string in `renderIzinKeluarSuratHTML`
(`Code.gs`): `keperluan`/`alasan_khusus` are guru-typed free text with no
content validation beyond a length cap (`izinText`), and this HTML gets
opened for real in a browser (preview iframe, print window) — unescaped, a
typed `<script>` would execute. `tests/izin-keluar-surat.test.js` pins this
with a literal script-tag payload.

Tests: `tests/izin-keluar-surat.test.js` drives `generateIzinKeluarSurat`
through real `doPost` — status gating (rejects `Menunggu Verifikasi`, accepts
`Sedang di Luar`/`Pulang`/`Selesai`), OSIS rejection, per-transaction read
scope (reuses `scopeIzinForUser`, not a second rule — also found and fixed in
the same pre-deploy review, see `generateIzinKeluarSuratData`'s own comment),
number format/sequencing/idempotency, audit logging, konteks accuracy
(including the injection case above), HTML-escaping, and a test that greps
`Code.gs` to make sure the QR/verification code never quietly comes back.

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

The `izin` report (Izin Keluar / Pulang) reads `Izin_Keluar` **as it is** — 21
columns, no new sheet, no new field, `level: 'umum'` so it inherits the exact
scope rules above. Excluded on purpose: NISN (same rule as every other report),
`ID_Izin`/`*_Oleh_ID`/`ID_Kelompok` (internal identifiers, same class as
`Dicatat_Oleh_ID`), and `Waktu_Verifikasi` — the last one **only** because it is
always byte-identical to `Waktu_Keluar` (both stamped in the same call), so
printing it twice just squeezes the other columns. The verifier's *name* is
still there. The activity name from `Izin_Kelompok` is not joined in — one
sheet, one report.

At 14 columns it is by far the widest report, which surfaced a latent bug in the
PDF writer: `pdfColumnWidths` split the page purely proportionally, so short
columns lost and dates printed as `14/01/2..` — truncation that reads as *wrong
data*, not merely cramped. Two fixes, both in `export-format.js`: reports with
more than `PDF_WIDE_COLS` (10) columns drop to 7pt (existing 6–7 column reports
are byte-identical, and a test pins that), and column widths now first try to fit
every cell whole, falling back to the old proportional split only when the
content genuinely can't fit. Don't reintroduce long enum labels in export `map`
functions for this reason — `izinTujuanLabel`/`izinJalurLabel` return one word
each ("Kembali"/"Pulang", "Normal"/"Khusus") on purpose; the column header
carries the meaning.

`getAuditLog` is **admin-only** (`isAdminRole`). It used to be admin +
BK/Kesiswaan (`isBkRole`); it was tightened when export landed, because the
Audit Log now also carries every export attempt — it is an oversight trail over
*everyone*, including admins, not a day-to-day BK tool. The gate is the role
check in `Code.gs`; dropping `'auditlog'` from `bk_kesiswaan` in `config.js`
(and the `roleKey !== 'admin'` guard in `fetchAuditLog`) only stops a request
that would now be rejected anyway.

### Push Notification (Web Push, VAPID)

SIGAP can notify a teacher even when the app isn't open, using standards-based
Web Push (the W3C Push API + VAPID) delivered through an installed PWA — no
native app, no paid SaaS. Read this whole section (and `Notifikasi.gs`'s own
header comment) before touching any part of this feature; it has more moving
pieces than most, and several of them exist specifically to route around a
real technical constraint rather than by choice.

**Why GAS can't send the push itself.** Actually sending a Web Push message
requires signing a VAPID JWT with ECDSA (P-256/ES256) for the `Authorization`
header, and encrypting the payload with an ECDH-derived key (RFC 8291/8292).
Apps Script's `Utilities` class only has hashing/HMAC — no ECDSA, no ECDH, no
AES-GCM. Implementing elliptic-curve crypto by hand in Apps Script JS was
rejected as too risky to get right and too fragile to maintain. So sending is
delegated to `api/push-send.js`, a small Node serverless function in the
**same Vercel project** that already hosts the static frontend (see the two
deploy targets note at the top of this file) — not a new vendor, not a new
hosting account. It uses the `web-push` npm package (a real dependency, not
dev-only — see `package.json`'s comment on why) purely to sign and encrypt;
it has **zero knowledge** of students, classes, wali kelas, or piket. GAS
remains the only place that decides *who* gets notified.

**Alternatives considered and rejected, with why:**
- **A third-party push SaaS** (OneSignal-style) would be simpler to wire up,
  but puts every teacher's subscription data on an external vendor's servers
  and ties the school to that vendor's free-tier terms. Rejected in favor of
  keeping subscriptions inside SIGAP's own Sheet, on infrastructure already
  used (Vercel).
- **Firebase Cloud Messaging** (Google, already Google-ecosystem-adjacent)
  was considered since GAS *can* call arbitrary Google APIs via a service
  account. Rejected because its web SDK is Chrome/FCM-endpoint-centric and
  would mean two different code paths depending on which browser handed back
  which kind of push endpoint — the raw W3C Push API is truly cross-browser
  (Chrome/Edge/Firefox on Android/desktop, and Safari on iOS/iPadOS 16.4+
  when installed) with one code path, which is what "prioritize cross-platform
  standards-based Web Push" in the brief for this feature actually asked for.

**Free tier, honestly.** Web Push itself has no per-message cost — it rides
each browser vendor's own push infrastructure for free. The only paid-service
surface is Vercel's serverless function invocations, which for one school's
volume (a handful of notifications per event, a few events per day) sits far
inside any free/hobby plan. There is no ongoing cost this introduces beyond
what already exists for hosting the frontend.

#### The two — and only two — recipient groups

Enforced entirely server-side in `resolvePushRecipients()` (`Notifikasi.gs`),
never by the client:

1. **Wali kelas** of the affected student's class — resolved by scanning
   `Master_Guru` for a non-`nonaktif` row whose `Kelas_Wali` matches (via the
   existing `sameClass()`, the same tolerant matcher used everywhere else)
   the student's class **as read from `Master_Siswa`**, never from
   `data.class_name` sent by the client. This matters concretely: `record`,
   `addSurat`, `addPelanggaran`, and `addPelanggaranUpacara` all *write*
   whatever class name the client sent (pre-existing behavior, unrelated to
   this feature — see their handlers in `Code.gs`), so before notifying,
   each of those hooks calls `resolveSiswaForIzin(ss, data.nisn)` (the same
   Master_Siswa lookup Izin Keluar already uses) purely to get a
   server-trusted class for recipient resolution. If the NISN isn't found
   there, no wali kelas notification is sent — never a guess from client data.
2. **Guru piket on duty on the day of the event** — from `Jadwal_Piket`,
   matched via the existing `hariPiketServer()`, and only when
   `event.needsPiketAction` is true (a real verification is actually
   waiting, not just "a request was filed"). Same "capacity from data, not
   from permanent role" principle as `izinKapasitasVerifikasi()`: a BK
   account that happens to be on today's piket roster is notified as piket;
   a BK account that isn't, is not notified at all by this feature (BK,
   Kesiswaan, Admin, and ordinary Guru Mapel never receive push notifications
   *because of their role* — only because of what the data says about them
   today).

Both groups are recomputed fresh on every event — there is no caching layer
between `Jadwal_Piket`/`Master_Guru` and a notification decision, so a
same-day piket shift change or a wali kelas reassignment takes effect on the
very next event, same as everywhere else piket/wali kelas is checked.

#### Event Notification Engine

One entry point, `notifyRelevantUsers(event)` (`Notifikasi.gs`), called from
`Code.gs` after the underlying write succeeds (never before, never replacing
it) in: `record`, `addSurat`, `addPelanggaran`, `addPelanggaranUpacara`,
`addIzinKeluar`, `verifikasiIzinKeluar`, `tandaiKembaliIzinKeluar`,
`tandaiPulangIzinKeluar`, `addIzinKelompok`, `verifikasiIzinKelompok`, and
`tandaiKembaliKelompok`. It never throws (wrapped in try/catch, same
guarantee as `logAudit()`) — a notification failure must never fail the
teacher's actual action. `Bimbingan_Khusus` is **deliberately excluded**:
it's already the one category with tighter-than-normal read access
(admin/BK only), and a push notification's mere existence would signal to a
wali kelas that a confidential counseling note was created about their
class's student, which is a different kind of leak than the notification
text itself revealing details — so it's left out of this feature entirely
rather than guessed at.

`notifyRelevantUsers()` doesn't call the network — it **enqueues** into the
`Push_Queue` sheet (see `SCHEMA.md`) and returns immediately, so recording a
lateness or an izin never waits on a round-trip to Vercel or to a push
service. A separate function, `processPushQueue()`, does the actual sending;
it's wired to a **time-based trigger, installed once manually** by running
`installPushQueueTrigger()` from the Apps Script editor (idempotent — safe to
run again, it checks for an existing trigger first). This is a manual
one-time step, consistent with this repo's existing "nothing auto-deploys
itself" posture for anything that touches the live Apps Script project — see
the clasp section above.

Izin Kelompok events are batched **per class, not per student**: a group
activity involving 8 students from the same class produces one wali-kelas
notification for that class, not 8 identical ones — see the `kelKelasNotified`/
`vkKelasNotified`/`tkKelasNotified` de-dupe maps in the three `addIzinKelompok`/
`verifikasiIzinKelompok`/`tandaiKembaliKelompok` handlers in `Code.gs`. The
piket ping for a group activity (jalur normal only) is sent once per
activity, separately from the per-class wali kelas notifications.

#### Privacy: what the notification is allowed to say

`pushSalinan(jenis, kind)` (`Notifikasi.gs`) is the **only** place notification
title/body text is produced. Title is always the literal string `"SIGAP"` —
never the event type. Body text for anything not explicitly listed in that
function's `switch` falls through to one fully generic sentence ("Terdapat
kejadian baru terkait salah satu siswa di kelas Anda.") — this is a
deliberate default-safe design: adding a new event type later and forgetting
to think about its sensitivity still produces a safe, generic notification,
never an accidental leak. `keterlambatan`/`surat`/the various `izin_*`
statuses get slightly more specific (but still never a student's name, NISN,
or note content) because a late-arrival or an izin status change was judged
low-sensitivity; `pelanggaran` and `pelanggaran_upacara` deliberately fall
through to the generic case. Piket notifications are always the literal copy
from the brief: "Izin siswa menunggu verifikasi. Buka SIGAP untuk memproses."
Tapping a notification only changes which tab is shown (via the `?goto=izin`/
`?goto=log` deep-link tokens, see below) — session and RBAC are re-checked in
full by every API call the destination screen makes, exactly as if the
teacher had navigated there by hand. A push notification is never treated as
proof of anything.

#### Idempotency & concurrency

`pushEventAlreadyQueued()` de-dupes on `Event_ID` (`jenis|refId|guruId|kind`)
within a rolling 2-minute window (`PUSH_QUEUE_DEDUPE_WINDOW_MS`), scanning
only the most recent `PUSH_QUEUE_DEDUPE_SCAN_ROWS` queue rows (the queue is
drained every minute, so it never grows large enough for a full scan to
matter). For the Izin Keluar/Kelompok family, this rides on top of guards
that already exist for other reasons: a double-submit of `addIzinKeluar` is
rejected by the existing open-transaction check (`findIzinTerbukaForNisn`)
*before* `notifyRelevantUsers()` is ever reached, and a retried
`verifikasiIzinKeluar`/`tandaiKembaliIzinKeluar`/`tandaiPulangIzinKeluar` is
rejected by the existing state-machine guard (status no longer matches the
required prior status) for the same reason — so the dedupe window in
`Notifikasi.gs` is a second, independent layer, not the only thing standing
between a flaky client and a duplicate notification. For `record`/
`addPelanggaran`/`addSurat`/`addPelanggaranUpacara`, which have no equivalent
business-key guard against a genuine double-click (a pre-existing property
of those actions, not something this feature changes), the 2-minute dedupe
window is what actually protects against a duplicate notification. Sending
itself is protected by `LockService.getScriptLock()` inside
`processPushQueue()` (a busy lock just skips that tick — the next one retries)
and per-row `Attempts`/`Processed` bookkeeping so a send failure doesn't lose
the row, and a send success doesn't accidentally resend it.

#### Device subscriptions

One row per browser/device in `Push_Subscriptions` (see `SCHEMA.md`), keyed
by `Endpoint` (upsert, not append) — **not** keyed by `Guru_ID`, so a shared
device (e.g. one tablet at the gate) re-subscribing under a different
logged-in teacher correctly **transfers ownership** of that endpoint rather
than accumulating stale rows under whoever subscribed first.
`savePushSubscription`/`deletePushSubscription` (`Code.gs`) always resolve
the owner from `sessionUser.id` — an id sent by the client is never trusted.
Logging out does **not** delete a device's subscription (that would defeat
the entire point — push has to keep working while the app is closed and the
teacher is logged out); the client instead self-heals on next boot
(`initPushRuntime()` in `notifikasi.js` silently re-sends the browser's
existing subscription if the browser still holds one and permission is still
granted). A subscription the push service reports as gone (404/410 from
`api/push-send.js`, surfaced back as `{gone: true}`) is pruned from
`Push_Subscriptions` by `processPushQueue()` the next time it's used — never
proactively polled.

#### PWA shell

`manifest.json` and `sw.js` (both new, at repo root, alongside `index.html`)
and `icons/icon-192.png`/`icons/icon-512.png` (a small navy-bell icon,
hand-generated with a pure Python PNG encoder — see the comment in
`Notifikasi.gs`'s neighborhood in git history if it ever needs
regenerating; no PIL/canvas/sharp is installed anywhere this repo builds).
`sw.js` is **deliberately minimal**: it has no `fetch` handler and touches no
Cache Storage API at all — `index.html`'s own `BUILD_VERSION` query-string
cache-busting (see the top of this file) is the *only* cache-versioning
mechanism for the app's JS, and a service worker that also tried to cache
those files would create two competing versioning schemes, which is exactly
the "stuck on an old frontend forever" failure mode this feature was told
not to introduce. `sw.js`'s only two jobs are the `push` event (show the
notification from the payload `pushSalinan()` already made privacy-safe) and
`notificationclick` (focus an existing tab and `postMessage` it a
`{type:'sigap-push-goto', goto}`, or open a new one at `/?goto=<token>` if
none is open). It is registered lazily, only for users `pushIsEligible()`
actually applies to (`notifikasi.js`, called from `app.js`), not for every
visitor — a plain guru who will never receive a notification never gets a
service worker registered on their device for this feature. `index.html`
itself never calls `serviceWorker.register` directly.

#### Onboarding & the settings screen

Per the brief: never trigger the browser's permission prompt without context
first. `NotifikasiOnboardingBanner` (`notifikasi.js`) shows the required
explanatory sentence on Beranda, for eligible users only, until the teacher
either activates or dismisses it (`localStorage`, per-teacher-id key — a
dismissal is remembered, not re-asked every visit). Only *after* a button
press does `Notification.requestPermission()` ever get called — never on
mount, never automatically. `NotifikasiTab` (reachable from the "Lainnya"
panel, added to `effectiveMenus` at runtime the same way `rekap`/`export`
are for a wali-kelas guru — see `pushIsEligible()`) is the "🔔 Notifikasi
Aktif" / "🔕 Notifikasi Belum Diaktifkan" status screen with Aktifkan/
Nonaktifkan, plus adaptive copy (`pushUnavailableReason()`) that tells an
iPhone/iPad user *specifically* to Add to Home Screen first (Safari only
supports Web Push for an installed/standalone PWA, iOS/iPadOS 16.4+) rather
than assuming everyone is on Android — while still defaulting to an
Android-appropriate message otherwise, since most users are expected to be
on Android.

#### One-time manual setup (this is not live until all of these are done)

None of this activates by merely merging the PR — consistent with this
repo's existing "nothing auto-deploys the backend" posture:

1. Generate a VAPID key pair once: `npx web-push generate-vapid-keys`.
2. Put the **public** key in `config.js` as `VAPID_PUBLIC_KEY` (replacing the
   `GANTI_DENGAN_...` placeholder) — it's meant to be public, safe to ship
   in the frontend, same trust level as `API_URL`/`API_TOKEN`.
3. In the Vercel project's dashboard (the same project already hosting the
   frontend), set env vars `VAPID_PUBLIC_KEY` (same value as step 2),
   `VAPID_PRIVATE_KEY` (the pair's private half — **never** put this in the
   repo), `VAPID_SUBJECT` (a `mailto:` contact address), and
   `PUSH_RELAY_SECRET` (any random string).
4. In Apps Script's Script Properties (Project Settings), add
   `PUSH_RELAY_URL` (the deployed `https://<your-vercel-domain>/api/push-send`
   URL) and `PUSH_RELAY_SECRET` (**must match** the Vercel value from step 3
   exactly).
5. Deploy the updated `.gs` files (`clasp:deploy`, per the existing manual
   process above) — `Notifikasi.gs` is now part of what `.claspignore` allows
   through.
6. From the Apps Script editor, run `installPushQueueTrigger()` **once**.
7. Bump `BUILD_VERSION` in `index.html` on this deploy (already done as part
   of adding `notifikasi.js` to the file list — bump it again on any later
   change to these files).

Skipping step 6 means events queue in `Push_Queue` forever and nothing is
ever sent (silently — worth checking `Push_Queue` for a growing backlog of
unprocessed rows if notifications don't seem to arrive). Skipping steps 3–4
means `processPushQueue()` keeps incrementing `Attempts`/`Last_Error =
'relay_not_configured'` on every row without ever giving up, and
self-recovers automatically the moment the env vars are filled in — no
re-deploy needed for that part.

#### Verified vs. not verified in this environment

Every piece of *logic* this feature depends on is covered by real tests (see
below) run against `doPost`/`doGet` and `processPushQueue()` executed for
real in a vm sandbox with Apps Script services stubbed. What could **not**
be verified from this development environment — no real Vercel deployment,
no real VAPID keys, no physical Android/iPhone device, no browser with a real
push subscription — is actual end-to-end delivery of a push notification to
a physical device while SIGAP is closed. That is the proof-of-concept a human
needs to run once, after completing the one-time setup above: log in as a
wali kelas on an Android phone and (if available) an iPhone/iPad, activate
notifications on both from the Notifikasi settings screen, close the app
completely on both, then have another account record a keterlambatan for a
student in that wali kelas's class, and confirm both devices receive it. If
that doesn't work, the failure is almost certainly in step 1–4 above (a
mismatched VAPID key pair between `config.js`/Vercel, a `PUSH_RELAY_SECRET`
mismatch between Vercel/Script Properties, or the Vercel env vars not being
set) rather than in the recipient-computation or queueing logic, which the
test suite already pins down.

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
scope, plus the Wali Kelas/Guru Mapel konteks label — derived correctly,
recomputed server-side even when the client sends a spoofed value, and never
gating anything); `tests/izin-keluar-frontend.test.js` covers its client
wiring (including the context card shown before the approval form) and now
pins down "no BETA label, no vendor-specific print-protocol assumptions"
(not "no printing" — printing shipped, see "Cetak Surat Izin Keluar" above).
`tests/izin-keluar-surat.test.js` covers the print feature itself (nomor
generation/sequencing/idempotency, status gating, audit trail, historical
konteks accuracy, HTML-escaping, and QR/verification) through real
`doPost`/`doGet` in its own sandbox.
`tests/izin-kelompok.test.js` does the same for Izin Kelompok (all-or-nothing
creation, partial verification, rombongan return with a student left outside,
one member going home while the rest return, cross-activity id tampering, and
that the individual flow still works beside it).
The Beranda notification/summary, its RBAC gating, the Gerbang badge, the
Beranda→Gerbang routing, the one-step "Tandai Kembali" close (column-by-column,
including that `selesaikanIzinKeluar` no longer exists), the card-level
"Disetujui oleh: Wali Kelas/Guru Mapel/Izin Khusus" labels, and the
"Guru Piket" vs "BK/Kesiswaan" verification-capacity audit (every combination
in the acceptance list — on-duty guru/wali/BK all label `guru_piket`,
off-duty BK/admin fall back to `bk_kesiswaan`, off-duty guru/wali are
rejected outright, OSIS is rejected, a client-sent `kapasitas` is ignored,
and multiple same-day piket teachers each verify independently) live in
those same two izin files; Export Izin Keluar is in `tests/export-backend.test.js`
(scope, tampering, leaked identifiers, audit) and `tests/export-frontend.test.js`
(14-column PDF/XLSX, and that narrow reports keep their old font size).

`tests/push-notifications.test.js` drives Push Notification through real
`doPost()`/`doGet()`/`processPushQueue()` calls (`Utils.gs`+`Auth.gs`+
`Notifikasi.gs`+`Code.gs` in one vm sandbox, `UrlFetchApp` stubbed to capture
the relay call instead of hitting a network): wali kelas receives only their
own class's events, BK/Kesiswaan/Admin/plain guru never receive wali-kelas
notifications, guru piket on duty (including a BK account that happens to be
on duty, and multiple simultaneous piket teachers) receives the
verification-needed ping while an off-duty guru does not, a verified izin
never produces a second verification ping, double-submit and a direct
`notifyRelevantUsers()` retry both produce exactly one queued row, one
teacher's subscription is never used or deleted by another's request, logout
leaves a subscription intact while re-subscribing the same endpoint under a
different login transfers ownership, a relay response marking a subscription
`gone` prunes it, subscription actions still require a valid session, a
pelanggaran notification body is always the generic safe sentence (never the
actual jenis/sanksi/catatan), and a same-day `Jadwal_Piket` edit changes the
very next event's recipients. `tests/push-frontend.test.js` covers
`notifikasi.js`'s pure logic (`pushIsEligible`, `urlBase64ToUint8Array`,
`pushUnavailableReason`'s iOS/Android branches, `consumePushGotoParam`'s URL
handling) plus static checks that `sw.js` never adds a `fetch`/Cache Storage
handler, that `manifest.json`'s icons actually exist on disk, and that
`index.html`/`package.json`/`.claspignore` are wired correctly (files array,
`BUILD_VERSION`, no direct `serviceWorker.register`, `web-push` as a real
dependency, `Notifikasi.gs` allowed through clasp). `NotifikasiOnboardingBanner`/
`NotifikasiTab` themselves are exercised (never throw, across eligible/
ineligible/dismissed states) as additional cases in `render-smoke.test.js`,
same as every other tab component.
