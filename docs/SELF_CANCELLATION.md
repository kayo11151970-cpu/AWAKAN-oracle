# Customer month-end cancellation

## Rollout

Prepared on `feat/self-cancellation-20261103`; the live site remains on main until the owner applies the new migration. The prior membership-admin migration has already been applied successfully in the live Supabase project according to the owner.

1. Guide the owner one action at a time through SQL Editor and run `supabase/migrations/20261103_self_cancellation.sql` once. It is transactional and repeatable. No service-role/secret key is needed in the browser.
2. After the owner reports success, publish the tested candidate to main, preserving intervening user changes. All three customer HTML copies and both admin HTML copies must match the generated source pages.
3. Test live with an existing authenticated test account. Do not repeatedly log out or resend login emails: standard Supabase email has already hit project rate limits during testing. SMTP is not changed by this feature.
4. Check customer request/undo, management display of reservation source, admin takeover, and post-expiration lock. Use test accounts only; never reset real customer dates.

Apply migrations in chronological/name order. Do not re-run the older admin migration after the self-cancellation migration, because its old function definitions do not contain the new reservation-source logic.

## Backend

`membership_end_source` is `customer`, `admin`, or null. Existing expiry dates without a source are conservatively classified as admin reservations. No reading dates, card numbers, trial flags, or activation credits are reset.

`awaken_self_cancellation(p_action, p_expected_end_at)` takes no customer UUID/email. Identity comes only from the verified JWT via `auth.uid()`. It locks that member row, requires a currently valid subscriber, and writes only the expiry/source fields. Anonymous/free/disabled/expired accounts cannot use it. Clients cannot update the underlying fields directly.

Customer requests use next month's first midnight in Asia/Tokyo as an exclusive deadline. The caller sends the date shown in the confirmation; if a new month began while the dialog was open, the RPC rejects the stale date and the UI reloads status instead of silently scheduling a different month. Repeated own requests retain the original date. An admin-owned reservation cannot be replaced or undone by the customer.

Undo is only permitted for an own, still-future reservation; it never grants an activation credit or alters the 168-hour clock. After expiry, only the owner can reactivate membership through the existing admin payment-confirmation action.

Admin `end_month` explicitly marks the reservation as admin, including takeover of a customer's reservation. Admin activation/continuation clears the source as well as the expiry, preserving the original idempotence/cooldown rules. Both old and new functions return compatible status payloads. Audits store customer operations with actor=target=the authenticated user's UUID.

## Frontend and tests

Customer actions are hidden until the new backend reports support. Free/disabled users do not see cancellation actions. Expired subscribers see information but no request/undo controls. Admin-owned deadlines show a non-cancellable notice. The confirmation and account section explain that this is AWAKEN membership cancellation and does not stop an external recurring payment.

All 44 images and approved texts are unchanged. Existing card draws still use only the server RPC. Both drawing and cancellation share the in-flight guard; mutations are never auto-retried after a network error. The UI reads the current status back after uncertain responses.

Build: `node scripts/build-number-draw.js` and `node scripts/build-admin.js`.

Tests: `npm --prefix member-tools ci`, `npm --prefix member-tools test`, `BROWSER_EXECUTABLE=/usr/bin/chromium npm --prefix member-tools run test:ui`, and `BROWSER_EXECUTABLE=/usr/bin/chromium npm --prefix member-tools run test:cancellation-ui`. The database tests execute in PGlite PostgreSQL; browser tests mock Supabase and do not send email or alter production records.
