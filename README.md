# Exotic Cars

A dealership shop with a 3D configurator built into every car. Browse the real stock, open a car, then choose a colour on a live 3D
model and add **wheels and aero kits that Dubai suppliers list for that exact car**.

```
npm install
npm run dev:api    # the API + a local database on :8787 (second terminal)
npm run dev        # website http://127.0.0.1:5173 · CRM http://127.0.0.1:5173/admin/
npm test           # vitest: parsers, fitment checks, totals, share links, API integration
npm run build      # website + CRM in dist/, API function in netlify/functions/
```

## Backend and CRM

The dealership runs the site from a CRM at **`/admin/`**: inventory (add, edit, photos, price, sold, hidden, featured),
wheels and kits (price, availability, finish, which cars they fit), a lead pipeline with drag and drop, bookings,
customer accounts, CSV exports and an activity log. Changes reach the website within a minute.

* **API:** one Netlify Function, `/api/v1/*` (`netlify/functions/api.mjs` → `server/`). Contract: `docs/openapi.yaml`.
* **Database:** Netlify Blobs (stock, catalogue, leads, bookings, customers, photos). Nothing to provision.
* **Website:** reads live stock and products from the API and falls back to `public/data/*.json`; enquiries and bookings
  go to the API, or wait in an on-device outbox when offline.
* **Deploy:** from Git or the Netlify CLI with `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (`npm run admin:hash`) and
  `SESSION_SECRET`. Step by step: **`docs/DEPLOY.md`**. Design and security review: `specs/crm-backend_design.md`.

## What the customer sees

| Page | What it does |
| --- | --- |
| `#/` Home | A magnifying dock (ported from a Motion/React component to vanilla JS, `src/ui/dock.js`): Models, Service appointment, VR & AR, Settings, Sign in |
| `#/shop` Shop | The client's real stock (see below): New arrival / Cars for sale / Previously sold tabs, make, model and year filters, search, photo gallery, specs, Book a viewing, and Configure in 3D when the car matches a catalogue model |
| `#/shop/<id>/configure` | The configurator for a stock car (its catalogue model): sticky 3D hero, colour swatches, wheels, body kits, details, running total and an **Enquire** sheet. Starts in the car's real colour |

Every selection is written to the URL (`#/shop/<id>/configure/<state>`), so a build can be shared or reloaded.

## How the 3D works

Cars are real, licensed models embedded through the Sketchfab Viewer API (`src/viewer/sketchfab.js`). The API can
recolour materials and move the camera but cannot add geometry, so:

* **Live on the car:** body paint (gloss / metallic / matte), custom colour, tap-a-panel colouring, glass tint,
  brake calipers, and rims when a clean rim material exists.
* **Chosen from the catalogue:** wheels and body kits (photo, size, price, fit check) - they go on the quote, not on the model.
* **Views are real views.** The car's own axes are derived from where its wheels sit (Sketchfab's world is Z-up),
  so "Side" is a true side elevation whatever the author's default camera is. A soft contact shadow is placed from the
  same geometry.

## Data pipeline (`tools/`)

```
npm run harvest -- <shopify host>   # crawl a supplier's public /products.json (resumable, cached in .cache/raw)
npm run db                          # build data/apex.db + public/data/{catalog,products}.json
npm run report                      # fitment coverage report
```

1. `tools/data/vehicles.mjs` (curated, with Dubai part matchers) and `tools/data/extra-vehicles.mjs` (~430 more) list
   generation-level cars with production years.
2. Products are parsed from supplier titles (fitment phrase, size/ET/PCD, design, finish, kit type) and linked to a
   car only when the title names it and the years overlap. Wheels whose stated bolt pattern contradicts the factory
   spec (ANKUSI open dataset, CC BY 4.0) are rejected. Surcharges, spacers and bolts are not treated as wheels.
3. Sketchfab search finds licensed models per car; titles that name a tuner, race series, game or another generation are
   filtered, and cars without a usable model are not listed. NHTSA vPIC cross-checks make/model names.

`npm run db` takes a few minutes the first time (network) and is fast once `.cache/` is warm.

## Sources and licences

* Wheels / kits: ATOMIC-SHOP and Al Khateeb (Dubai), prices in AED as published.
* Factory fitment: ANKUSI Wheel Fitment Dataset (CC BY 4.0). Vehicle names: NHTSA vPIC.
* 3D models: Sketchfab, each credited on its car page (author, licence, link).
* Brand marks: Simple Icons (CC0 artwork; marks belong to their owners). Makes without a mark are set in type.
* Type: Jost (SIL OFL) via Fontsource.

## Layout

```
src/app.js            hash router
src/pages/car.js      car page (hero, sections, bar, enquiry sheet)
src/viewer/           Sketchfab wrapper (materials, axes, cameras)
src/state/build.js    paints, BOM, quantities, share links (pure, tested)
src/state/outbox.js   enquiries and bookings to the API, with an offline queue
src/data/api.js       API client used by the website
src/data/catalog.js   catalogue queries, fitment checks, labels
admin/index.html      CRM entry; src/admin/ its views, styles and API client
server/               API: routes (app.mjs), auth, validation, storage, data
netlify/functions/    the Netlify Function wrapping server/app.mjs
tools/                data pipeline, dev-api.mjs, admin-hash.mjs
```
## Dealership stock (the Shop)

Imported from the client's own website with their permission (`exoticcars.ae`):

```
npm run stock      # crawl (1 request/second) -> data/stock.db + public/data/stock.json + public/stock/<id>.webp covers
```

`tools/harvest/exotic.mjs` calls the same JSON endpoint the site's stock page uses, `tools/build-stock.mjs` normalises it
(408 cars for sale, 70 sold, 18 brands; the site lists no prices, so cars show "Price on request"). Cover photos are
downloaded and resized; gallery photos stay linked to the dealer's own image URLs. Re-run `npm run stock` to refresh.