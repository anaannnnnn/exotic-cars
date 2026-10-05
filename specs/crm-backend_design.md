# Exotic Cars backend and CRM: technical design

Status: implemented on `feature/fullscreen-configurator-3zqcym`. Skills followed: fullstack-guardian (three-perspective design, security checkpoint), api-designer (REST, RFC 7807 errors, pagination, versioning, OpenAPI 3.1), secure-code-guardian (hashing, sessions, rate limits, headers).

## 1. Requirements

**Customers (public site)**
- See the live stock and the wheels and kits that fit each car, as edited by the dealership.
- Send an enquiry from the 3D configurator (car, paint, wheels, kits, total, share link) and from a car's page.
- Book a service, a repair, a quote, a test drive or a call-back.
- Create an account and sign in on any device.

**Dealership staff (CRM at `/admin/`)**
- Sign in securely.
- Dashboard: stock, sold, new leads, upcoming appointments, pipeline value, stock by make, recent activity.
- Inventory: add, edit, hide, mark sold, feature or remove cars, with photos uploaded from a phone or computer.
- Products: add, edit, re-price, mark unavailable or remove wheels and body kits, and set which cars they fit.
- Leads: a pipeline board (New, Contacted, Qualified, Negotiating, Won, Lost) with drag and drop, notes, and call/WhatsApp/email shortcuts.
- Appointments: confirm, complete, cancel or mark no-show; notes.
- Customers: accounts with their enquiries and bookings; delete on request.
- Settings: import the site's data, export CSV, check the system.

**Acceptance criteria**
1. A change saved in the CRM (price, sold, hidden, new car) shows on the public site within one minute, with no redeploy.
2. A configurator enquiry and a service booking appear in the CRM with every detail the customer chose.
3. Without an admin session every `/api/v1/admin/*` call returns 401; public endpoints never expose staff notes, password hashes or hidden cars.
4. The public site keeps working when the backend is unreachable (static stock, bookings kept on the device and sent later).
5. Two editors saving the same record cannot overwrite each other silently (409 Conflict).

## 2. Architecture

```
Browser (public site, /)              Browser (CRM, /admin/)
   |  fetch /api/v1/...                  |  fetch /api/v1/admin/... (HttpOnly session cookie)
   v                                     v
Netlify Function  netlify/functions/api.mjs   (one function, path /api/v1/*, small router)
   |   lib/http   lib/auth   lib/validate   lib/repo   lib/ratelimit
   v
Netlify Blobs (strong consistency for writes and staff reads)
   store "catalog": cars (one document), products (one document)
   store "crm":     leads/<id>, appointments/<id>, customers/<hash>, notes inside records
   store "media":   uploaded photos (webp/jpeg), served by /api/v1/media/<key>
   store "system":  rate-limit buckets, audit log entries, seed marker
```

Decisions (ADR summary):
- **Netlify Functions + Netlify Blobs.** The site already ships on Netlify. Blobs need no external database account or connection string and come with the site. One function with an internal router keeps cold starts low and makes local development a single process.
- **Cars and products as two documents.** The public site needs the whole stock and catalogue in one request, at about 2.5 MB and 3.2 MB. Each edit is a read-modify-write guarded by `onlyIfMatch` (the entity tag), so concurrent edits fail with 409 instead of being lost.
- **CRM records one key each**, with time-sortable keys (`<base36 ms>-<random>`), so listing is chronological without an index document.
- **Stateless sessions:** HMAC-SHA-256 signed tokens in `HttpOnly; Secure; SameSite=Strict` cookies, expiring after 12 hours (staff) or 30 days (customers).
- **Static fallback:** `/data/*.json` stays in the build. The public site reads the API first and falls back to these files, so a drag-and-drop deploy (no functions) still shows the showroom.

## 3. Data model

`Car`: `id` (int), `title`, `brand`, `model`, `year`, `km`, `price` (AED or null), `engine`, `hp`, `cylinders`, `transmission`, `body`, `exterior`, `interior`, `doors`, `region`, `warranty`, `description`, `subtitle`, `newArrival`, `featured`, `sold`, `hidden`, `video`, `cover`, `gallery[]`, `url`, `listedAt`, `updatedAt`.

`Product`: `id`, `source`, `vendor`, `title`, `sku`, `url`, `priceAED`, `available`, `category` (`wheel` or `kit`), `subtype`, `material`, `images[]`, `fitment` (text), `fits[]` (catalogue vehicle ids), plus wheel fields (`design`, `construction`, `centerLock`, `spec`, `finish`, `paintable`).

`Lead`: `id`, `ref`, `type` (`configuration`, `viewing`, `general`), `status`, `name`, `phone`, `email`, `message`, `car` (`{ id, title }`), `configuration` (`{ paint, wheels[], kits[], total, url }`), `source`, `notes[]` (`{ at, by, text }`), `history[]` (status changes), `createdAt`, `updatedAt`.

`Appointment`: `id`, `ref`, `service`, `car`, `date`, `slot`, `name`, `phone`, `email`, `notes`, `status` (`requested`, `confirmed`, `completed`, `cancelled`, `no-show`), `staffNotes[]`, `createdAt`, `updatedAt`.

`Customer`: `id` (SHA-256 of the email), `name`, `email`, `phone`, `passwordHash` (scrypt, never returned), `createdAt`, `lastLoginAt`.

## 4. API (v1, JSON, RFC 7807 errors)

Public:
- `GET /api/v1/health`
- `GET /api/v1/stock`
- `GET /api/v1/products`
- `GET /api/v1/media/:key`
- `POST /api/v1/leads`
- `POST /api/v1/appointments`
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`

Staff:
- `POST /api/v1/admin/session`, `DELETE /api/v1/admin/session`, `GET /api/v1/admin/session`
- `GET /api/v1/admin/stats`
- `GET|POST /api/v1/admin/cars`, `GET|PATCH|DELETE /api/v1/admin/cars/:id`
- `GET|POST /api/v1/admin/products`, `GET|PATCH|DELETE /api/v1/admin/products/:id`
- `GET /api/v1/admin/leads`, `GET|PATCH|DELETE /api/v1/admin/leads/:id`, `POST /api/v1/admin/leads/:id/notes`
- `GET /api/v1/admin/appointments`, `GET|PATCH|DELETE /api/v1/admin/appointments/:id`, `POST /api/v1/admin/appointments/:id/notes`
- `GET /api/v1/admin/customers`, `GET|DELETE /api/v1/admin/customers/:id`
- `POST /api/v1/admin/media`
- `POST /api/v1/admin/import`
- `GET /api/v1/admin/export/:collection` (CSV)

Collections take `limit`/`offset` (and `q`, `status`, `make`, `category` filters) and return `{ data, pagination: { total, limit, offset, next } }`. The full contract is `docs/openapi.yaml`.

## 5. Security checkpoint

| Concern | Control |
| --- | --- |
| Staff authentication | `ADMIN_EMAIL` plus `ADMIN_PASSWORD_HASH` (scrypt, made with `npm run admin:hash`) or `ADMIN_PASSWORD`; constant-time comparison; generic error messages. |
| Brute force | Per-IP rate limits: staff login 8 per 15 min, customer login and registration 10 per 15 min, public forms 20 per hour. Returns 429 with `Retry-After`. |
| Sessions | HMAC-SHA-256 signed with `SESSION_SECRET` (32+ characters, required). Cookie is `HttpOnly; Secure; SameSite=Strict; Path=/`. Tokens expire, and signatures are checked in constant time. |
| CSRF | SameSite=Strict cookies, and every mutating request must carry a same-origin `Origin` header. |
| Authorisation | Every `/admin/*` route goes through `requireStaff`. Customer routes only ever read the session's own record. |
| Input validation | Zod schemas on every body and query: lengths, enums, integer ranges, and URL schemes limited to `https:` or `/api/v1/media/`. Unknown keys are stripped. A honeypot field on public forms. |
| Output encoding | Both front ends build the DOM with `textContent` only and never `innerHTML` with data. CSV export guards against formula injection (`=`, `+`, `-`, `@`). |
| Data exposure | Public stock omits hidden cars. Password hashes and staff notes never leave staff endpoints. Errors never echo raw input. |
| Uploads | Images only (`image/jpeg`, `image/png`, `image/webp`) up to 4 MB, re-encoded in the browser, stored under random keys, served with `nosniff`. |
| Headers | API: `Cache-Control: no-store` on staff and auth routes, `X-Content-Type-Options`, `Referrer-Policy`. `/admin/*`: strict CSP, `frame-ancestors 'none'`, `noindex`. |
| Secrets | Only from environment variables. Without them the CRM refuses sign-in with a clear setup message. |
| Logging | Failed and successful staff logins, rate-limit hits and destructive actions go to the `system` audit log (no passwords or tokens). |

## 6. Testing

- API integration tests (`tests/api.test.mjs`) against a local Blobs server cover health, the import, public reads, validation (400), authentication (401), rate limits (429), the CRUD lifecycle, conflicts (409), lead and appointment flows, and that customer data and hidden cars are not leaked.
- Browser checks (Playwright) cover the CRM sign-in, inventory edit to public site, the pipeline drag, and the booking-to-CRM flow.

## 7. Implementation notes

- **Idempotent forms.** Enquiries and bookings may carry a client reference (`EX-…`, `AA-…`). The server claims `lead-refs/<ref>` or `appointment-refs/<ref>` with `onlyIfNew` before writing the record, so a phone that retries (dropped connection, offline outbox in `src/state/outbox.js`) never creates a duplicate. The same reference is returned with 200.
- **Concurrency.** Documents and CRM records are updated through `updateDoc`: a per-key in-process queue (one warm function instance, or the dev server) plus `onlyIfMatch` on the entity tag across instances, with up to three re-reads before 409. The local Blobs emulator returns no entity tags, so locally only the queue applies; production Blobs return them.
- **Covers.** Imported cars keep their self-hosted `/stock/<id>.webp`. When the CRM changes a cover (or uploads one, or adds a car) the car gets `customCover` and the public stock adds `thumb`, which the site prefers.
- **Fitment from the CRM.** A product with `fits` (catalogue vehicle ids) is listed as a direct fit on exactly those vehicles; the website applies this in `applyFits` (`src/data/catalog.js`) after loading. Products marked unavailable are left out of the configurator.
- **Public reads.** `/stock` and `/products` send an entity tag (the document's, or a SHA-1 of the body) with `Cache-Control: public, max-age=0, must-revalidate` and `Netlify-CDN-Cache-Control: public, s-maxage=30, stale-while-revalidate=30`, so a CRM change is public within a minute.
- **Customer accounts made before the backend.** Device-only accounts (PBKDF2 in localStorage) move to the server on the next successful sign-in.
