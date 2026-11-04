# Paid email pre-registration

## Rollout and current boundary

Prepared on `feat/paid-preregistration-20261104`. Do not change main until the owner has run `supabase/migrations/20261104_paid_preregistration.sql` in the correct project and reported Success. Prior migrations (membership admin, self cancellation, admin list) are already installed according to the owner. Apply new migrations in order; do not rerun older function definitions afterward.

Guide the owner one action at a time. After the SQL succeeds, publish only the tested administrator UI/copies and source files. Customer HTML, card images/texts, session-storage code and existing SQL files are unchanged. The new migration adds a private paid-reservation table and guarded RPCs; the existing status/draw entry points first consume a verified reservation, then run the same membership/cooldown logic as before.

All tests used local PostgreSQL and mocked browser APIs. No real auth/signup/invitation email was requested. Live first-mail verification is deliberately deferred because the project is currently hitting standard Supabase mail limits. Standard SMTP recipient/rate restrictions are NOT bypassed by pre-registration; custom SMTP is still needed before wider customer signup.

## Owner workflow

After confirming payment, enter the customer's intended email in the new pre-registration form and confirm. Unknown/unconfirmed customers appear as `事前登録・初回認証待ち`, including accounts not yet present in Supabase Auth Users. No auth account is created and no mail is sent by this action. The existing customer's login form remains the place to request their first verification mail.

For an already verified free/expired account, the owner action uses the existing payment-confirmed activation RPC immediately. For a currently active subscriber, duplicate pre-registration is a no-op: it must not reset a cooldown, add credit, or erase a cancellation. Continuing a cancelled-but-active membership remains the existing explicit management action.

Pending registrations can be cancelled by the owner to correct an address. Cancellation removes only the pending paid reservation, not the customer's account or trial/card records. If the reservation has already been claimed, the owner must use the existing membership actions instead. A repeated pending registration is idempotent; re-registering an explicitly cancelled pending address is an intentional new owner payment-confirmation action.

## Verified claiming

`claim_paid_registration(uid)` is private and not callable by anonymous/authenticated clients. Status/draw call it using only `auth.uid()`. It reads the email and confirmation status from `auth.users`, not browser claims/user-editable metadata. A matching unclaimed, uncancelled reservation locks before the member row. Only a confirmed identity can receive a grant.

New/free members receive one activation credit; trial is permanently marked used, prior card/time remain intact, and the next successful draw restarts 168 hours. Claimed reservations are permanently bound to the immutable user UUID. Repeated status/login/draw calls cannot grant the credit twice. A matching reservation for an independently active subscriber is simply marked consumed, preserving their cooldown/cancellation. Stale reservations never revive disabled or expired memberships.

No PayPal integration, password handling, service-role keys, forged email confirmation or bypass of email ownership verification is introduced. Normal users cannot write reservations or grant admin/membership privileges. The private reservation table has RLS and no public/authenticated grants. Existing member-table grants/policies remain.

## Listing and lookup

The read-only list/lookup include unclaimed reservations without inserting user/member records. The preregistration filter excludes active/expired/disabled states; pending entries cannot use month-end/activation buttons before identity confirmation. The dedicated cancellation action is admin-only. Existing filters, pagination, literal email search and existing membership operations remain.

## Tests

`npm --prefix member-tools test` includes the new DB lifecycle test. Browser: `BROWSER_EXECUTABLE=/usr/bin/chromium npm --prefix member-tools run test:preregister-ui`, plus existing `test:ui`, `test:list-ui`, `test:cancellation-ui`.

New tests verify no Auth user creation/mail calls, admin-only access, private-table access denial, normalized/repeated registration, initial verified claim, direct draw claim, no extra credit on repeated login, preserved card/time, active cancellation/cooldown preservation, stale disabled reservation safety, free-trial and expiry enforcement, readonly listing, and migration reapplication without data changes. Live email-delivery tests remain outstanding until the owner is ready.
