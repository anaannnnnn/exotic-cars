# Deploying Exotic Cars (website, CRM and backend)

One project zip holds everything. The host builds it and serves four parts:

| Part | What it is | Where |
| --- | --- | --- |
| Website | The showroom and 3D configurator | `dist/` (built by `npm run build`) |
| CRM | The staff back office at `/admin/` | `admin/index.html` + `src/admin/*` (part of the build) |
| API | `/api/v1/*` | `server/*`, run by `api/index.js` on Vercel or `netlify/functions/api.mjs` on Netlify |
| Database | Stock, catalogue, leads, bookings, customers, photos | Vercel: Postgres (Neon). Netlify: Netlify Blobs. |

Make the zip from a checkout with `git archive --format=zip -o exotic-cars.zip HEAD` (files at the root, no wrapping folder).

## 1. Vercel

1. **Deploy the zip.** Sign in at [vercel.com](https://vercel.com), open [vercel.com/drop](https://vercel.com/drop), drop the zip,
   name the project and press **Deploy**. Vercel reads `vercel.json`, runs `npm install` and `npm run build`, publishes `dist/`
   and deploys the API function. The showroom works straight away (from its built-in data).
2. **Connect the database.** In the project: **Storage → Create Database → Neon (Postgres) → Continue**, keep the free plan,
   **Connect** it to the project, then **Deployments → ⋯ → Redeploy** so the API sees it. Vercel adds `DATABASE_URL` itself;
   the table is created on first use.
3. **Sign in.** Open `https://<your-project>.vercel.app/admin/` and sign in with **admin** / **admin123**. The first sign-in
   copies the 478 cars and 3,401 wheels and kits into the database. Then go to **Settings → Your login** and set your own
   password straight away: until you do, anyone who guesses the default can open the CRM. Once set, admin123 stops working.

Later updates: drop a newer zip onto the project in the Vercel dashboard (or connect the GitHub repository for automatic
deploys).

## 2. Netlify

1. Sign in at [app.netlify.com](https://app.netlify.com) **first** (signed out, Drop publishes the raw source instead of
   building it), then drop the zip on [app.netlify.com/drop](https://app.netlify.com/drop). Netlify reads `netlify.toml`, builds
   the site and deploys the API function. Storage is Netlify Blobs: nothing to connect.
2. Open `https://<your-site>.netlify.app/admin/`, sign in with **admin** / **admin123** and change the password (as above).

Other ways: import the GitHub repository (**Add new site → Import an existing project**), or `npx netlify deploy --build --prod`.

## 3. Optional environment variables

Nothing has to be set. These override the defaults when you want them (Vercel: **Settings → Environment Variables**;
Netlify: **Site configuration → Environment variables**; redeploy after changing them).

| Name | What it does |
| --- | --- |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` | Use this staff login instead of admin / the password set in the CRM. Also the way back in if the CRM password is forgotten. Make the hash with `npm run admin:hash -- "your password"`. (`ADMIN_PASSWORD` in plain text works for a quick trial.) |
| `SESSION_SECRET` | 32+ random characters to sign sign-in cookies. Without it the site generates one and keeps it in its database. |
| `DATABASE_URL` | Any Postgres database (set automatically by Neon on Vercel). When set, it is used on Netlify too. |
| `ALLOWED_ORIGINS` | Extra origins allowed to send forms, comma-separated (e.g. a custom domain during a move). |

## 4. What staff get

- edits in **Inventory** and **Wheels & kits** reach the website within about a minute, without a redeploy;
- enquiries from the configurator ("Send to the dealership") and car pages ("Enquire") arrive in **Leads**;
- service bookings, test drives and call-backs arrive in **Bookings**;
- accounts created on the website's Account page appear in **Customers**;
- **Settings**: re-import or reset the data, CSV exports, system check, change password, activity log.

## 5. How the website uses the API

| The website… | With the backend | Without it (no database yet, static-only deploy, offline) |
| --- | --- | --- |
| Stock and catalogue | `GET /api/v1/stock`, `/api/v1/products` (CDN-cached for 30 s, then revalidated) | `/data/stock.json`, `/data/products.json` |
| Enquiries and bookings | `POST /api/v1/leads`, `/api/v1/appointments` | Kept on the phone in an outbox and sent automatically later. Each request has its own reference, so a retry never duplicates it. |
| Customer accounts | `/api/v1/auth/*` (scrypt passwords, HttpOnly cookie, works on every device) | Device-only accounts (PBKDF2). They move to the server the first time the customer signs in once it is available. |

## 6. Run everything locally

```
npm install
npm run dev:api     # API + local Blobs store on :8787 (data in .netlify/dev-blobs)
npm run dev         # website on http://127.0.0.1:5173, CRM on http://127.0.0.1:5173/admin/
```

Sign in to the local CRM with admin / admin123. Set `DATABASE_URL` before `npm run dev:api` to use a Postgres
database instead. `npm test` runs the unit tests and the API integration suite twice: on a local Blobs server and on
Postgres (PGlite).

## 7. Security in short

- Staff and customer sessions are HMAC-signed, `HttpOnly; Secure; SameSite=Strict` cookies (12 hours for staff, 30 days for customers). Changing the staff password ends every other staff session.
- The project ships with the login admin / admin123 and the CRM shows a warning until it is changed; setting a password in Settings replaces it for good.
- Every state-changing request must come from the site's own origin (CSRF check), on top of `SameSite=Strict`.
- Rate limits per client address (an IPv6 client counts by its /64): staff sign-in and setup 8 per 15 minutes, customer sign-in and sign-up 10 per 15 minutes, forms 20 per hour.
- A customer sees only bookings made while signed in to their account, never ones matched by email.
- Every body and query is validated (Zod); unknown fields are dropped; links must be `https://` or an uploaded photo.
- Uploads: JPEG, PNG or WebP only (checked by file signature, not by name), up to 4 MB, resized in the browser first.
- The CRM page has a strict Content-Security-Policy, cannot be framed and is not indexed.
- Public endpoints never return hidden cars, staff notes or password hashes. CSV exports are protected against spreadsheet formulas.

The full design and threat checklist is in `specs/crm-backend_design.md`; the API contract is `docs/openapi.yaml`.

## 8. Limits and backups

- Vercel functions accept and return at most 4.5 MB per request: photo uploads are capped at 4 MB, and the largest API
  response (the catalogue, about 3.2 MB) fits.
- Neon's free plan stores 0.5 GB: the stock and catalogue use about 6 MB, each uploaded photo a few hundred KB.
- For your own copies, use **Settings → Export** (CSV for leads, bookings, customers, inventory and products) on a regular
  schedule.
