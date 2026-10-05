# Deploying Exotic Cars with the backend and CRM

The site has two parts that ship together on Netlify:

| Part | What it is | Where |
| --- | --- | --- |
| Website | The static showroom and 3D configurator | `dist/` (built by `npm run build`) |
| API | One Netlify Function serving `/api/v1/*` | `netlify/functions/api.mjs` → `server/*` |
| CRM | The staff back office at `/admin/` | `admin/index.html` + `src/admin/*` (part of the build) |
| Database | Netlify Blobs: stock, catalogue, leads, bookings, customers, photos | created automatically, nothing to set up |

## 1. Deploy from Git (recommended)

Netlify must **build** the site so the function is bundled. A drag-and-drop upload of a zip or `dist/` folder publishes only the
static website: the showroom still works from its built-in data, but the CRM and live data need the function.

1. In Netlify: **Add new site → Import an existing project → GitHub →** `anaannnnnn/exotic-cars`.
2. Build settings come from `netlify.toml` (`npm run build`, publish `dist`, functions `netlify/functions`). Leave them as they are.
3. Add the environment variables below (**Site configuration → Environment variables**), then **Deploy**.

Or from a terminal, with the Netlify CLI:

```
npm install
npx netlify login
npx netlify init            # link or create the site
npx netlify env:set ADMIN_EMAIL "sales@your-dealership.ae"
npx netlify env:set ADMIN_PASSWORD_HASH "$(npm run -s admin:hash -- 'a long staff password')"
npx netlify env:set SESSION_SECRET "$(openssl rand -hex 32)"
npx netlify deploy --build --prod
```

## 2. Environment variables

| Name | Required | What it is |
| --- | --- | --- |
| `ADMIN_EMAIL` | yes | The staff sign-in email for the CRM. |
| `ADMIN_PASSWORD_HASH` | yes* | The staff password, hashed. Make it with `npm run admin:hash -- "your password"` (scrypt). The password itself is never stored. |
| `ADMIN_PASSWORD` | * | Plain-text alternative to the hash, for a quick trial only. Use the hash in production. |
| `SESSION_SECRET` | yes | At least 32 random characters, e.g. `openssl rand -hex 32`. Signs the sign-in cookies. Changing it signs everyone out. |
| `ALLOWED_ORIGINS` | no | Extra origins allowed to send forms, comma-separated (e.g. a custom domain during a move). The site's own origin is always allowed. |

\* Set one of `ADMIN_PASSWORD_HASH` or `ADMIN_PASSWORD`. Without these the CRM sign-in page says what is missing, and the website keeps
working from its built-in data.

## 3. First sign-in

Open `https://<your-site>/admin/` and sign in. The first sign-in copies the website's built-in stock (478 cars) and catalogue
(3,401 wheels and kits) into the database. From then on:

- edits in **Inventory** and **Wheels & kits** reach the website within about a minute, without a redeploy;
- enquiries from the configurator ("Send to the dealership") and car pages ("Enquire") arrive in **Leads**;
- service bookings, test drives and call-backs arrive in **Bookings**;
- accounts created on the website's Account page appear in **Customers**.

**Settings** can re-import missing data, reset stock and catalogue to the website copy, export any list as CSV, check the system,
and show the activity log (sign-ins, imports, exports, deletions).

## 4. How the website uses the API

| The website… | With the backend | Without it (static deploy, offline) |
| --- | --- | --- |
| Stock and catalogue | `GET /api/v1/stock`, `/api/v1/products` (CDN-cached for 30 s, then revalidated) | `/data/stock.json`, `/data/products.json` |
| Enquiries and bookings | `POST /api/v1/leads`, `/api/v1/appointments` | Kept on the phone in an outbox and sent automatically later. Each request has its own reference, so a retry never duplicates it. |
| Customer accounts | `/api/v1/auth/*` (scrypt passwords, HttpOnly cookie, works on every device) | Device-only accounts (PBKDF2). They move to the server the first time the customer signs in once it is available. |

## 5. Run everything locally

```
npm install
npm run dev:api     # API + local Blobs store on :8787 (data in .netlify/dev-blobs)
npm run dev         # website on http://127.0.0.1:5173, CRM on http://127.0.0.1:5173/admin/
```

`dev:api` prints a local-only sign-in (`admin@exoticcars.local` / `showroom-dev`) unless you set `ADMIN_EMAIL` and
`ADMIN_PASSWORD(_HASH)` yourself. `npm test` runs the unit tests and the API integration tests (`tests/api.test.mjs`, against a
temporary Blobs store).

## 6. Security in short

- Staff and customer sessions are HMAC-signed, `HttpOnly; Secure; SameSite=Strict` cookies (12 hours for staff, 30 days for customers).
- Every state-changing request must come from the site's own origin (CSRF check), on top of `SameSite=Strict`.
- Rate limits per client address (an IPv6 client counts by its /64): staff sign-in 8 per 15 minutes, customer sign-in and sign-up 10 per 15 minutes, forms 20 per hour.
- A customer sees only bookings made while signed in to their account, never ones matched by email.
- Every body and query is validated (Zod); unknown fields are dropped; links must be `https://` or an uploaded photo.
- Uploads: JPEG, PNG or WebP only (checked by file signature, not by name), up to 4 MB, resized in the browser first.
- The CRM page has a strict Content-Security-Policy, cannot be framed and is not indexed.
- Public endpoints never return hidden cars, staff notes or password hashes. CSV exports are protected against spreadsheet formulas.

The full design and threat checklist is in `specs/crm-backend_design.md`; the API contract is `docs/openapi.yaml`.

## 7. Backups

Netlify Blobs are stored with the site. For your own copies, use **Settings → Export** (CSV for leads, bookings, customers,
inventory and products) on a regular schedule.
