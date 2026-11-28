# Acode - Official Website Repository

Welcome to the repository for Acode's official website. This project contains the source code and content for [acode.app](https://acode.app), the home of Acode - a powerful and versatile code editor for Android/IOS devices.

## About Acode

Acode is a lightweight yet robust code editor designed specifically for Android/IOS. It supports a wide range of programming languages, including but not limited to:

- HTML
- JavaScript
- Python
- Java
- CSS
- Dart

With Acode, you can:

- Edit and create websites, and instantly preview them in a browser.
- Seamlessly modify source files for various languages.
- Utilize GitHub integration for efficient version control.
- Manage files via FTP/SFTP support.
- Enjoy syntax highlighting for over 100 programming languages.
- Customize the interface with multiple themes.
- Use the in-app preview for HTML and Markdown files.
- Debug using the integrated JavaScript console.
- Enhance functionality with a collection of over 195 plugins.
- Agentic development, multi pane and many more.

For more details, visit the [Acode website](https://acode.app).

## Repository Structure

This repository is organized as follows:

- `/client`: Contains the React components and logic for the website.
- `/server`: Includes the backend code for handling API requests and server-side logic.
- `/public`: Houses static assets, built files and the main HTML files.
- `/dev`: Contains development scripts and tools.
- `/cron-jobs/`: Includes scripts for scheduled tasks and maintenance.

## Plugin security scanning

Uploaded plugins are checked with [plugin_scanner](https://github.com/Acode-Foundation/plugin_scanner):

- **New plugins** are scanned on upload. The verdict is stored and shown to admins on the plugin's **Security** tab. They still need admin approval as before.
- **Updates to published plugins** go to `data/plugins/pending/` first, and the scanner compares them with the live zip. If nothing risky was added, the update goes live straight away. Otherwise it is held until an admin approves or rejects it under **Admin → Plugin updates**. Users keep the live version meanwhile, and the developer is emailed either way.
- If the scanner is missing or fails, updates are held (fail closed).

Install the scanner on the server and point `PLUGIN_SCANNER_BIN` at it (defaults to `plugin_scanner` on `PATH`):

```sh
git clone https://github.com/Acode-Foundation/plugin_scanner
cd plugin_scanner && cargo build --release
sudo install -m 755 target/release/plugin_scanner /usr/local/bin/plugin_scanner
```

Scan results are stored in the `plugin_scan` table, one row per upload.

## Public plugin badges and stats

Replace `your.plugin.id` with the ID from `plugin.json`:

```markdown
![Downloads](https://acode.app/api/plugin-stats/your.plugin.id/downloads.svg)
```

Use `rating.svg`, `version.svg` or `updated.svg` for the other badges. Fetch `https://acode.app/api/plugin-stats/your.plugin.id` for JSON. No API key is required; only approved plugins are public. Badge/JSON responses cache for five minutes; OG images cache for two days and then refresh in the background.

The [full guide](https://docs.acode.app/docs/getting-started/plugin-badges) is maintained in the separate `Acode-Foundation/acode-plugin-docs` repository. Publish the companion docs change with the API release before enabling the docs homepage announcement; the guide URL may return 404 until that deployment.

## iOS sponsorship purchases

Deploy the companion sponsor API changes before releasing the iOS client. App Store Connect must contain the six **consumable** product IDs `crystal`, `bronze`, `silver`, `gold`, `platinum`, and `titanium` for bundle `app.acode`. Each payment grants 30 days from its verified purchase date. Separate payments keep separate listings; these are not auto-renewing subscriptions.

The API uses [Apple's server library](https://github.com/apple/app-store-server-library-node) to verify signed StoreKit transactions, with certificate revocation checks. The bundled `server/certificates/AppleRootCA-G3.cer` comes from [Apple PKI](https://www.apple.com/certificateauthority/AppleRootCA-G3.cer). No App Store API private key is needed for registration receipt verification. The daily refund check requires an App Store Connect In-App Purchase key: configure `APPLE_STORE_ISSUER_ID`, `APPLE_STORE_KEY_ID`, and `APPLE_STORE_PRIVATE_KEY` (PEM) as shown in `.env.example`. These are separate from the Sign in with Apple credentials. Sandbox transactions are verified separately and do not send thank-you emails. They honor the public-listing checkbox when the server runs with `NODE_ENV=development`; otherwise they stay private. Existing sandbox records saved as private are not changed automatically. Local Xcode StoreKit signatures are never accepted by the server; native tests mock only the sponsor HTTP responses.

Registration is idempotent by store transaction ID. The app finishes a consumable only after registration succeeds and retries unfinished purchases with saved sponsor details at startup, on resume, when connectivity returns, and when the sponsor page is reopened. The existing daily sponsor job refreshes both stores: Google by purchase token, Apple by the environment and transaction ID in `order_id`. Apple responses are signature-verified before updating `status` and `reason`; refunds/revocations set `APPLE_REFUND_OR_REVOCATION`, and a later valid state clears the reason without extending expiry. No notification endpoint or event table is needed. Refunds take effect on the next successful daily check (normally within 24 hours). Provider failures leave the affected row unchanged for a later retry. Apple transaction lookups abort after 30 seconds, including stalled response bodies. Missing configuration or HTTP 401/403 skips remaining Apple rows for that run; three timeout/network/429/5xx failures without a successful Apple lookup do the same. The job logs a warning, continues Google checks and retries Apple on the next daily run. Transaction-specific failures such as an invalid transaction ID do not stop other Apple checks.

Registration returns 201 for a new sponsorship and 200 for an already registered purchase. Clients accept a successful JSON acknowledgement before finishing the consumable and retain failed registrations for retry. Malformed fields return 400, invalid purchases return 403, unavailable verification or a busy database returns 503, and other registration failures return 500. Failed thank-you emails do not fail registration. Purchase POST requests are limited to 20 per IP per 15 minutes; clients should retain unfinished purchases on errors, including 429.

Sponsor fields must be strings: name (required, up to 200 characters), email (320), website (2048), and tagline (500). Optional text/image fields may be omitted or null. Public visibility accepts booleans or numeric 0/1; strings such as `"false"` and null are rejected. Allowed store packages are `app.acode`, `com.foxdebug.acode`, and `com.foxdebug.acodefree`; purchases must have quantity one (the API treats an omitted quantity as one for both stores). New Apple rows keep an empty token because refresh uses their transaction ID. Purchase tokens are capped at 32768 characters and image data URLs at 2 MiB of text; unusable images within the request limits still only drop the logo. Websites are normalized to HTTP(S), defaulting scheme-less domains to HTTPS; unsafe schemes and URLs containing usernames/passwords are rejected, and unsafe stored links are not rendered on sponsor cards.

The companion Acode client preserves the paid transaction after a JSON 400 response, clears its rejected details, and prompts for replacement details on reopening Sponsorship. Cancelling that prompt leaves the transaction unfinished for later recovery. This requires the companion `src/pages/sponsor/purchases.js` update; older clients keep retrying their saved details.

Legacy Google sponsorships with missing expiry are repaired only after successful purchase verification, either during a duplicate registration or the daily refresh. They receive 30 days from the verified Google purchase time; existing expiry is preserved atomically, including when already expired. Existing populated expiry dates are not recalculated. Migration 021 adds the sponsor `reason` column and an order lookup/uniqueness index; if duplicates already exist, it preserves them and installs insert/update guards instead of deleting data.

Run the isolated sponsorship checks with `npm test -- tests/unit/apple-sponsor-purchase.test.js tests/unit/sponsor-purchase-route.test.js tests/unit/sponsor-persistence.test.js tests/unit/sponsors.test.js tests/unit/sponsor-image.test.js tests/unit/sponsor-website.test.js tests/unit/rate-limits.test.js tests/unit/send-email.test.js`. These use mocks, temporary image files, and a disposable in-memory database, never the application database. Image-route checks require permission to listen on a local HTTP port.

## Contributing

We welcome contributions to improve the Acode website. To contribute:

1. Fork this repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and ensure they are well-tested.
4. Submit a pull request with a clear description of your changes.

Please adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) in all interactions.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contact

For any inquiries or support, please visit our [contact page](https://acode.app/contact) or reach out via [email](mailto:support@acode.app).

---

_Empower your coding journey with Acode—code anytime, anywhere._
