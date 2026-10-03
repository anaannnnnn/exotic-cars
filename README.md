# Exotic Cars

A dealership shop with a 3D configurator built into every car. Browse the real stock, open a car, then choose a colour on a live 3D
model and add **wheels and aero kits that Dubai suppliers list for that exact car**.

```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: parsers, fitment checks, totals, share links
npm run build      # static site in dist/
```

## What the customer sees

| Page | What it does |
| --- | --- |
| `#/` Home | Black and lime storefront with featured stock, make shortcuts and a floating dock: Home, Explore, Service, VR & AR, Settings, Account |
| `#/shop` Shop | The client's real stock (see below): New arrival / Cars for sale / Previously sold tabs, make, model and year filters, search, photo gallery, specs, Book a viewing, and Configure in 3D when the car matches a catalogue model |
| `#/shop/<id>/configure` | The configurator for a stock car (its catalogue model): full-screen 3D stage, compact Paint / Wheels / Aero / Details / Info tabs, collapsible option panel, running total and an **Enquire** sheet. Starts in the car's real colour |

GSAP drives page entrances, scroll reveals, the sliding dock indicator and option transitions. Both the operating system’s reduced-motion preference and the app’s Motion setting are respected. The mobile configurator uses a compact bottom panel that can collapse to expose more of the stage. Dialogs trap keyboard focus and return it to their opener.

The app keeps its existing vanilla JavaScript/Vite architecture. Service and account preferences remain local to this device.

Every selection is written to the URL (`#/shop/<id>/configure/<state>`), so a build can be shared or reloaded.

## How the 3D works

While models load, the configurator shows the original stock photograph. If the external viewer fails, a retry control remains available; camera presets and image export stay disabled until a live model is ready. The photograph does not simulate paint changes.

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
* Type: Instrument Sans and Jost (SIL OFL) via Fontsource.

## Layout

```
src/app.js            hash router
src/pages/car.js      full-screen configurator, compact tabs, enquiry sheet
src/ui/motion.js      GSAP page and option motion with reduced-motion support
src/ui/dock.js        persistent keyboard-accessible navigation dock
src/styles/redesign.css  black/lime responsive theme
src/viewer/           Sketchfab wrapper (materials, axes, cameras)
src/state/build.js    paints, BOM, quantities, share links (pure, tested)
src/data/catalog.js   catalogue queries, fitment checks, labels
tools/                data pipeline
```
## Dealership stock (the Shop)

Imported from the client's own website with their permission (`exoticcars.ae`):

```
npm run stock      # crawl (1 request/second) -> data/stock.db + public/data/stock.json + public/stock/<id>.webp covers
```

`tools/harvest/exotic.mjs` calls the same JSON endpoint the site's stock page uses, `tools/build-stock.mjs` normalises it
(408 cars for sale, 70 sold, 18 brands; the site lists no prices, so cars show "Price on request"). Cover photos are
downloaded and resized; gallery photos stay linked to the dealer's own image URLs. Re-run `npm run stock` to refresh.