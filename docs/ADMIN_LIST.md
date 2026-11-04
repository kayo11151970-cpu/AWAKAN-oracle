# Desktop-friendly administrator list

## Rollout

The owner confirmed the live Supabase metadata before implementation: all ten member columns, RLS enabled, `authenticated` cannot UPDATE, both own-row select policies, and the six existing status/draw/admin/cancellation RPCs.

Prepared on `feat/admin-list-20261104`. Main remains unchanged until the owner applies `supabase/migrations/20261104_admin_list.sql`. The migration creates only one read-only function and its execute permissions; it does not alter tables, row policies, existing functions, administrator identities, trial state, readings, cooldowns, cancellations, or audit records.

Guide the owner one action at a time: new SQL query, paste the additional SQL, Run, confirm Success. Then publish the candidate administrator page to both `admin/index.html` and `docs/admin/index.html`, preserving any intervening user changes. Customer pages are not changed. Verify the live admin page using the existing session; no repeated login email is needed.

## List access and contents

`awaken_admin_list(p_filter, p_search, p_page, p_page_size)` is STABLE, SECURITY DEFINER with an empty search path and checks `awaken_is_admin()` before accessing any user records. Anonymous users cannot execute it. Normal authenticated users fail the owner check. Do not grant clients SELECT on `auth.users` or broaden member-table policies.

Only email, UUID, confirmation/registration timestamps and the existing member-state payload are returned. Passwords, auth tokens, raw user metadata and admin/audit tables are not returned. Real customer emails stay in Supabase and browser memory; none are baked into the static GitHub files or stored in browser localStorage by the listing feature.

Registrations with no member row are represented as virtual unused trials. Listing never calls `awaken_status()` for those users and never inserts profiles. Effective statuses come from the same private `member_state()` used by drawing and cancellation. Expired subscribers are therefore excluded from the active-member/ending filters even if their stored membership string is still subscriber.

Filters: all; active members; all free trials; future customer/admin ending reservations; expired memberships; disabled. Partial email search is literal, trimmed, case insensitive (wildcards and SQL snippets are not interpreted). Newest registrations first, stable UUID tie break, 25/50/100 row page sizes; the backend also bounds pages and search length. Results include a filtered total, with no silent truncation.

Desktop: eight-column table with sticky headers/action cells and contained scrolling. Mobile: the same rows become labelled cards. Dates use Asia/Tokyo. The end date shows the final usable day and the exclusive cutoff timestamp. Unconfirmed accounts are marked and cannot be activated until email verification.

## Existing actions

Each row offers details, activation/continuation and month-end cancellation subject to the existing rules. All mutations still call `awaken_admin_change()` with the selected immutable user UUID. The list RPC never performs actions. Confirmation includes the account email. Controls lock while updates are in flight. The currently filtered page refreshes after a successful action; changing membership can correctly remove a row from that filter. The detail panel and the original exact-email lookup remain available.

Admin takeover of a customer cancellation retains the existing lock semantics. Owner-initiated expiry cannot be undone by the customer. Activation of an already active account does not reset a cooldown or grant extra draws. These SQL functions are not modified by this feature.

An auth/session change hides the manager, removes loaded table rows/detail texts and invalidates pending list responses. A response arriving after logout cannot redisplay private data. Emails are rendered with textContent, never as HTML.

## Testing

`npm --prefix member-tools test` runs the database privilege/read-only/list tests and all existing membership/cancellation/email-error tests. PGlite executes the SQL, including a READ ONLY transaction and checks that member/audit data are unchanged.

`BROWSER_EXECUTABLE=/usr/bin/chromium npm --prefix member-tools run test:list-ui` covers search, filters, paging, row actions, empty/unconfirmed states, desktop/mobile widths, ordinary-user gating and late responses after a session change. Other existing UI suites remain `test:ui` and `test:cancellation-ui`. Browser APIs are mocked; live listing verification follows the owner's migration.

Build: `node scripts/build-admin.js`. Static list data are not generated at build time.
