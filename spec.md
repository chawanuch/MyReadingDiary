# My Reading Diary

## Project

- Confirmed project: p01, room r0001, membership r0001_u13.
- Application port: 31131. Local development host: 127.0.0.1.
- Runtime: Node.js >=22 supporting process.loadEnvFile, CommonJS, server.js.
- Storage: browser Local Storage only. No database connection or credentials required.
- Parent project is unrelated and must not be modified.

## Requirements

1. Record book title, author, reading date, pages read, and a reading summary.
2. The save-reading button persists the record and updates the displayed list.
3. Delete records after confirmation; cancellation preserves data.
4. Show the total number of completed books, independent of search and filters.
5. Search book titles; author and summary search are also supported.
6. Keep data after reload through Local Storage.
7. Use a colorful blue-and-white, student-friendly interface with mint, peach, and yellow accents.
8. Support desktop and mobile, keyboard navigation, visible focus, and reduced motion.
9. Provide a day/night toggle in the header, with an accessible pressed state and browser-local preference persistence. Follow system color scheme until a user preference is selected; synchronize theme changes across tabs without blocking reading-record edits. Theme switching still works if storage is unavailable, but cannot persist in that case.

Theme preference uses the separate key my-reading-diary:p01:theme and does not modify reading records. Dark mode covers cards, dialogs, inputs, status badges, notices, and native form controls.

## Record Semantics

One record represents one book. Update its most recent reading date, summary, and cumulative pages as reading progresses. This version does not keep a separate history of daily sessions. Adding the same title twice creates two separate records; there is no automatic title deduplication.

Fields:

| Field | Constraint |
| --- | --- |
| id | Random 128-bit hexadecimal identifier |
| title | Required, trimmed, maximum 200 characters |
| author | Required for new/edited records, maximum 160 characters |
| date | Required valid YYYY-MM-DD calendar date |
| pages | Total book pages, integer 1..100000 |
| current | Cumulative pages read, integer 0..pages |
| status | want, reading, or done |
| notes | Required summary for new/edited records, maximum 5000 characters |

Selecting done sets current to pages. Completed-book count uses status=done; reading all pages without selecting done does not mark completion automatically. Total pages is the sum of cumulative pages across records, not a daily-session total.

Older records without a date remain visible with an unspecified-date label; editing requires choosing a date. Existing optional author/summary values remain readable.

## Starter Books

A browser with no diary storage key receives four editable sample books: The Little Prince, Totto-chan, The Secret Garden, and Around the World in Eighty Days. Samples use stable starter-1 through starter-4 IDs, want status, zero pages read, and explicitly illustrative page counts. The date is the sample creation date, not a claimed reading date. The samples are included in public/index.js, so a new browser displays them without manual entry.

Existing diaries are never overwritten or merged with samples. An intentionally empty saved array remains empty after reload; deleted samples do not return. If the initial storage write fails, samples are shown temporarily with a warning. This is first-use example data, not database synchronization.

## Storage and Safety

- Key: my-reading-diary:p01:v1; maximum 500 records and 4,000,000 serialized characters.
- Data belongs to this browser profile and origin (scheme, host, port). It is not shared between devices or accounts.
- Browser data clearing, private browsing expiration, origin changes, or device loss can remove access. No export, backup, authentication, or cloud sync is provided.
- Invalid/corrupt stored data blocks writes without deleting the original value.
- Failed writes do not replace the displayed in-memory records. Cross-tab changes block further writes until reload; simultaneous writes are not transactional.
- User content is rendered with textContent, never injected as HTML.
- Local Storage is not suitable for secrets or sensitive personal information.

## Source Structure

- package.json
- server.js
- public/index.html
- public/style.css
- public/index.js
- public/images/ (twelve PNG book-cover illustrations)
- .env (local/managed environment; never commit or upload as source)
- .gitignore
- spec.md (non-executable documentation)

The production dependency qrcode generates the optional sharing QR image. There are no application npm installation lifecycle scripts, build output, migrations, or database calls. Application source files must each remain below 1 MiB.

## Running Locally

The local .env contains nonsecret PORT=31131 and HOST=127.0.0.1. Read configuration through process.env; do not hard-code credentials. Start using npm.cmd start from this directory on Windows, then open http://127.0.0.1:31131. npm.cmd run check checks server and frontend syntax. Other supported environments can use npm start and npm run check.

For platform deployment, configure HOST through the managed environment if required by the platform routing contract; the local loopback setting is not a deployment-routing guarantee.

## Backend Contract

- GET/HEAD / and /index.html: HTML.
- GET/HEAD /style.css and /index.js: static assets.
- GET/HEAD /api/health: JSON status=ok, storage=browser-local.
- Other methods: 405; unlisted paths: 404; malformed URLs: 400 where rejected by URL parsing.
- Explicit asset allowlist and realpath checks reject arbitrary files and symlink redirection.
- CSP, frame denial, nosniff, no-referrer, disabled device permissions, and no-store headers apply.
- Request/header/keep-alive timeouts and a connection limit are configured. No reading-data endpoints exist.

## Acceptance Checks

Create, edit, search, filter, reload, and delete a reading record; cancel deletion; check completed-book and cumulative-page totals. Validate required fields, date validity, numeric bounds, overflow pages, literal HTML input, empty/search-empty states, unavailable/corrupt/full storage, older records, and cross-tab write blocking. Check desktop and narrow-mobile layout and dialog usability.

Check backend assets and HEAD responses, health, denied methods, secret/source/traversal denial, headers, valid environment configuration, ignore rules, and source file sizes before Deploy.

## Local Verification (2026-11-01)

- Passed npm syntax checks and editor diagnostics for server.js and all frontend files.
- Theme update passed: day/night toggle, reload persistence, accessible pressed state, native control color scheme, dialogs, system preference tracking, explicit preference priority, cross-tab theme sync, and storage-write failure fallback. All four existing books remained unchanged and searchable; theme-only changes did not block reading-record edits.
- Both themes passed horizontal-overflow checks at widths 320, 375, 768, and 1280 pixels. Dark desktop appearance was visually inspected.
- Browser checks passed: create/edit/delete, delete cancellation, date persistence, numeric overflow rejection, title search, status filters, completed/page totals, reload persistence, and literal HTML rendering without image injection.
- Mobile viewport 375x812 passed horizontal-overflow check; desktop was checked at 1280x900. These are targeted checks, not an exhaustive browser/device matrix.
- Corrupt data preserved with writes blocked; simulated quota failure left records unchanged; an actual value change from another tab blocked writes. A no-op write of the same value correctly produced no storage event.
- Backend checks passed: five GET/HEAD routes, security headers, ten denied secret/arbitrary/traversal paths, four denied HTTP methods, health response, and three invalid PORT cases.
- .env and node_modules ignore rules verified; all five application source files are below 1 MiB; production dependency count is zero.
- Semgrep, OSV scanner, and Gitleaks were unavailable locally. Required platform security scans, deployed isolation/routing, and live symlink-race testing remain unverified. No Deploy or database operation was performed.

## Deployment Policy

Policy revision 2, hash bef855c538ab3b91967a18c7dcc5cbb73a3cb55c7c0119187c17816d769529a7.

- Recheck backend before every Deploy. This document is not a scan approval.
- Semgrep, OSV, and Gitleaks block high findings. Platform scans are required on upload/git/manual/before-public, with results at most 24 hours old and a 300-second job timeout.
- Public publication is disabled in this room. No deployment/public route is performed by this task.
- Run non-root with platform isolation and 192 MiB memory limit. Install dependencies with lifecycle scripts disabled.
- Never include .env, credentials, node_modules, or secrets in Git/public artifacts.
- Database access is not implemented. If later required, reconfirm current p01 connection metadata and use DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD server-side only. Do not use legacy database values or guess host/password.
- Server migrations are submitted separately through the database workflow with append-only history, never via server.js, npm, or Git. Authorized local SQL, if needed in a future task, must first verify SELECT DATABASE() for the confirmed project.
- Images are stored in public/images and must be sanitized by decode/re-encode under platform limits. The backend explicitly allowlists twelve book-cover PNG routes.

## Deployment Preparation (2026-11-01)

- Owner confirmed project p01 and https://github.com/chawanuch/MyReadingDiary, branch main.
- Git is initialized inside MyReadingDiary, separately from the unrelated parent repository.
- Local environment fields are filled; values are not recorded here or committed. Managed server environment remains revision 1 and retains platform-managed PORT/DB values.
- Database schema and migrations are not applicable to the current browser-local feature set; no SQL was executed.
- Fresh local backend checks passed: HTML GET/HEAD, CSS, JS, one book-cover image, health, denied .env/server.js, and denied POST.
- Local npm audit could not run without a lockfile; required platform scans remain the deployment gate.
- Deployment, scan approval, and live checks are pending; preparation is not proof of deployment.
