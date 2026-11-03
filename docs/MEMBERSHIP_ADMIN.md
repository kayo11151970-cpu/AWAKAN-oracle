# AWAKEN membership administration

## Rollout status

Prepared on the feature branch; do not switch the live customer page until the SQL migration succeeds. The live project cannot be administered by the agent: only a publishable key is available. Do not request or place a service-role/secret key in the browser.

1. The owner runs `supabase/migrations/20261103_member_admin.sql` once in the correct Supabase project SQL Editor. It is transactional and repeatable. It requires the existing `awaken_members` table and a confirmed owner account matching the UUID already used in testing. It preserves existing readings and trial records. Do not run against a different project.
2. After the owner reports success, publish the prepared frontend and admin files from this branch to main, preserving any intervening user changes. Root/index and docs/index must contain the same new customer page; admin/index and docs/admin/index must contain the same admin page.
3. Confirm Supabase allows new user sign-ups and Email confirmation remains enabled. Site URL remains `https://kayo11151970-cpu.github.io/AWAKAN-oracle/`.
4. Test owner login, admin permission, customer signup, ordinary-customer denial, activation credit and monthly expiry against live Supabase. No live changes or email delivery were performed by local tests.
5. Supabase's default email sender is restricted to project-team addresses and has low rate limits. A custom SMTP sender is required before general customers can reliably self-register. Configure a verified sender using the provider's current supported settings; do not promise free unlimited mail. Guide the owner one operation at a time. No PayPal integration is required.

## Source and builds

- `number-draw/cards.json`: unchanged approved card information.
- `number-draw/auth.js`: customer login and status logic. Build into `number-draw/index.html` using `node scripts/build-number-draw.js`.
- `admin/template.html` and `admin/admin.js`: management page. Build using `node scripts/build-admin.js`.
- `supabase/migrations/20261103_member_admin.sql`: backend membership rules and admin privileges.
- `member-tools/`: isolated, version-pinned development test tools. `npm ci`, then `npm test`; browser checks: `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:ui` or install Playwright Chromium and run `npm run test:ui`.

## Membership rules

Free trial: one draw after email authentication. Trial state is stored in the database, not browser history. Separate emails can create separate accounts; this is not proof of unique human identity.

Paid activation: an inactive/expired/free account receives one activation credit immediately. Existing reading dates and cards remain. Repeating activation for an active subscriber does not reset the last draw or add a credit. Trial use is permanently consumed on activation.

Subscriber draw: activation credit or no prior reading or at least 168 elapsed hours since last reading. A successful draw consumes credit and restarts the 168-hour interval. Both draw and admin edits lock the member row, so simultaneous actions cannot reset the cooldown accidentally.

Month-end cancellation: save the next month's first midnight in Asia/Tokyo as an exclusive expiration. The original 168-hour interval continues until then. Every status/draw checks expiry on the server; no cron job or owner action at month-end is needed. Once expired, no new draw or revived free trial. The previous card remains readable. Reactivating an expired account after a new payment provides one new credit. Continuing a still-active account with a scheduled expiry removes the expiry without providing an extra draw.

## Administrative security

Only the verified owner UUID is bootstrapped into a non-public schema. No browser-writeable field, email string, URL, or user metadata grants admin privileges. All lookup/change RPCs check the immutable authenticated UUID against that table before accessing customer records. No admin privilege is stored in localStorage.

Authenticated ordinary users can inspect only their own member rows and cannot update membership, timestamps, trial flags, activation credits, or private tables. Admin searches are exact-email only; there is no public directory. Customer addresses and mutation audit records remain in Supabase, not GitHub.

The static admin HTML and static card images can be read as public assets on GitHub Pages. Privileged operations/customer records are protected by Supabase. Protecting the card artwork itself as a paywalled asset would require a separate private-storage change.

## Recovery

The migration is a transaction: an error before commit rolls back the additions. Reapplying it does not reset usage. The old draw RPC signature is preserved. If frontend rollback is needed after migration, restore the previous page while retaining the backend usage records; do not delete tables or reset trials. An old client may not display a newly granted activation credit until the new frontend is restored.

Never reset production usage dates to test cooldowns. Use designated test accounts.
