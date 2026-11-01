# My Reading Diary

## Project

- Confirmed project: p01, room r0001, membership r0001_u13.
- Application port: 31131. Local development host: 127.0.0.1.
- Runtime: Node.js >=22 supporting process.loadEnvFile, CommonJS, server.js.
- Storage: shared MariaDB database db_std13_p01, owner std13, port 3306. Connection secrets stay server-side in process.env.
- No per-user authentication: anyone with access to this application can view/change the shared collection.
- Parent project is unrelated and must not be modified.

## Requirements

1. Record book title, author, reading date, pages read, and a reading summary.
2. The save-reading button persists the record and updates the displayed list.
3. Delete records after confirmation; cancellation preserves data.
4. Show the total number of completed books, independent of search and filters.
5. Search book titles; author and summary search are also supported.
6. Keep data after reload and across devices through MariaDB; theme preference alone uses Local Storage.
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

Dates must be valid calendar dates between 1000-01-01 and 9999-12-31. Database records include an integer version for optimistic concurrency. Editing and deletion send the version captured when the dialog opened; stale versions return 409.

## Existing Browser Data

No sample records are seeded. The previous key my-reading-diary:p01:v1 is checked only to show a legacy-data notice; it is never overwritten, deleted, or imported automatically. The visible collection comes exclusively from GET /api/books. Recommendations remain static suggestions, not saved records until explicitly submitted.

## Storage and Safety

- Table reading_books uses InnoDB, utf8mb4, a 32-hex primary key, validation constraints, version, and created/updated timestamps. Schema is supplied separately in migrations.sql, excluded from Git.
- Maximum 500 shared records; creation uses a database advisory lock and transaction. Update/delete use row locks and version checks. SQL is parameterized.
- Loading, failure, stale cached display, and genuinely empty results are distinct states. Mutations are disabled until a successful read.
- Failed or ambiguous writes preserve form input and require a refresh before retry; no automatic write retries. UI changes only after confirmed responses.
- User content is rendered with textContent. Browser cross-origin writes are rejected; these checks are not authentication.
- No automatic migration, seed, browser import, backup, or per-user isolation is implemented. Avoid sensitive information.

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

Production dependencies are mysql2 (database driver) and qrcode (optional sharing QR). Install with lifecycle scripts disabled. Application source files must each remain below 1 MiB. No migration executes from npm or server startup.

## Running Locally

The local .env provides PORT=31131, HOST, NODE_ENV, DB_HOST, DB_PORT=3306, DB_NAME, DB_USER, and DB_PASSWORD. Use the actual learner-accessible host locally; never copy it over server-managed DB settings. Read configuration through process.env; do not hard-code credentials. Start using npm.cmd start from this directory on Windows, then open http://127.0.0.1:31131. npm.cmd run check checks server and frontend syntax. Other supported environments can use npm start and npm run check.

For platform deployment, configure HOST through the managed environment if required by the platform routing contract; the local loopback setting is not a deployment-routing guarantee.

## Backend Contract

- GET/HEAD / and /index.html: HTML.
- GET/HEAD /style.css and /index.js: static assets.
- GET/HEAD /api/health: DB connection check, JSON status=ok, storage=mariadb; 503 on unavailable storage.
- GET /api/books: {books}; POST /api/books: accepts all record fields including id, returns 201 {book}.
- PUT /api/books/:id: accepts fields without id plus version; returns {book} with incremented version.
- DELETE /api/books/:id: accepts {version}; returns {id}.
- Invalid data returns 400, missing rows 404, stale versions/duplicates/record cap 409, and storage errors 503. JSON body limit is 64 KiB.
- Other methods: 405; unlisted paths: 404; malformed URLs: 400 where rejected by URL parsing.
- Explicit asset allowlist and realpath checks reject arbitrary files and symlink redirection.
- CSP, frame denial, nosniff, no-referrer, disabled device permissions, and no-store headers apply.
- Request/header/keep-alive timeouts, a four-connection DB pool, queue limit, and server connection limit are configured.

## Acceptance Checks

Create/read/update/delete uniquely tagged test records through browser/API and verify database values, IDs, version increments, refresh persistence, and stale-version rejection. Test validation, search/filter/stats, delete cancellation, literal HTML, empty/loading/unavailable states, mobile layout, and existing browser data preservation. Delete only test-owned records. Old browser-storage tests are historical and are not evidence of database integration.

Check backend assets and HEAD responses, health, denied methods, secret/source/traversal denial, headers, valid environment configuration, ignore rules, and source file sizes before Deploy.

## MariaDB Integration Verification (2026-11-01)

These checks used the current local application at http://127.0.0.1:54329 and the actual confirmed p01 MariaDB database, not a mock driver.

- Verified SELECT DATABASE() equals db_std13_p01 before SQL. The database initially had no tables; executed the exact local migrations.sql once through the authorized owner connection. SHOW CREATE TABLE confirmed the schema, index, and constraints. No startup migration or seed was added.
- Browser Create returned a unique ID and version 1; direct database reads confirmed Thai text, date, pages, progress, and notes. Reload preserved the saved record.
- Browser Update to done returned version 2 and current=pages; reload preserved the update. A concurrent update reached version 3; submitting the older edit returned 409 without overwriting it and preserved form input.
- Invalid progress above page count returned 400; stale deletion returned 409 without changing the row. Delete cancellation preserved the record. Search, completed counts, and page totals matched saved values.
- Literal HTML in notes remained text with no injected image. Layout had no horizontal overflow at widths 320, 375, 768, and 1280 pixels.
- An intercepted GET returning 503 verified cached-display and disabled-write behavior; removing interception and refreshing recovered. This was a simulated API failure, not an actual database-outage test.
- Browser Delete removed only the uniquely tagged test record. Reload and API returned an empty collection; direct SQL lookup confirmed that test ID no longer existed. Existing user data was not removed.
- Syntax checks, editor diagnostics, git diff --check, and ignore checks passed. No full CRUD rerun is needed for subsequent documentation-only changes.
- Fresh pre-release backend smoke checks passed: HTML GET/HEAD, CSS, JS, one cover image, MariaDB health, denied .env/server.js/migrations.sql/traversal paths, and denied PATCH. CSP, DENY framing, and nosniff headers were present. All five source files are below 1 MiB; only the two declared production dependencies are used. These are local checks, not deployed routing or scan approval.

### Migration Submission Status

The local migrations.sql is available separately and excluded from Git. Actual schema creation succeeded through the authorized local database connection. Platform migration history remains revision 0: preview rejected both the complete SQL and a simpler CREATE TABLE with "Unsupported or invalid MariaDB syntax". No previewId was issued, so no migration upload or platform Apply is claimed. executionAvailable was false. Platform acceptance is still blocked independently of the existing working database schema.

### Release Status

Managed environment revision 1 already contains the required PORT, NODE_ENV, and DB keys; it was preserved unchanged. Local database integration is verified, but a new successful platform deployment and live runtime verification are still pending. Earlier deployment jobs failed with BUILD_CAPTURE_FAILED; they are not successful releases.

## Historical Local-Storage Verification (2026-11-01)

These checks were run before the MariaDB conversion and do not verify the current database-backed implementation.

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

Policy revision 3, hash bb989ad6e209522d0b71fa4ae5ed88b4a4b46311e928b3b99ba3a97f571c48dc.

- Recheck backend before every Deploy. This document is not a scan approval.
- Advanced scanners are currently off. Mandatory ownership, isolation, routing and secret safety remain enforced; re-read effective policy before deploying.
- Public publication is disabled in this room. Authorized private project deployment is separate from public publication; do not request a public route.
- Run non-root with platform isolation and 192 MiB memory limit. Install dependencies with lifecycle scripts disabled.
- Never include .env, credentials, node_modules, or secrets in Git/public artifacts.
- Database access uses only p01 metadata and server-side DB environment variables. First local SQL must verify SELECT DATABASE() equals db_std13_p01. Never use legacy credentials, root, or guessed values.
- Server migrations are submitted separately through the database workflow with append-only history, never via server.js, npm, or Git. Authorized local SQL, if needed in a future task, must first verify SELECT DATABASE() for the confirmed project.
- Images are stored in public/images and must be sanitized by decode/re-encode under platform limits. The backend explicitly allowlists twelve book-cover PNG routes.

## Historical Deployment Preparation (2026-11-01)

The following describes the earlier browser-only release, not the current database integration or a successful deployment.

- Owner confirmed project p01 and https://github.com/chawanuch/MyReadingDiary, branch main.
- Git is initialized inside MyReadingDiary, separately from the unrelated parent repository.
- Local environment fields are filled; values are not recorded here or committed. Managed server environment remains revision 1 and retains platform-managed PORT/DB values.
- Database schema and migrations are not applicable to the current browser-local feature set; no SQL was executed.
- Fresh local backend checks passed: HTML GET/HEAD, CSS, JS, one book-cover image, health, denied .env/server.js, and denied POST.
- Local npm audit could not run without a lockfile; required platform scans remain the deployment gate.
- Deployment, scan approval, and live checks are pending; preparation is not proof of deployment.
