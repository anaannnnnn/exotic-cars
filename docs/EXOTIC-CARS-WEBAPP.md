# Exotic Cars web app: full project document

Version 2.1.0 · Document date: 5 October 2026 · Repository: `anaannnnnn/exotic-cars` (private)

---

## 1. What it is

Exotic Cars is a mobile-first web app for a luxury and exotic car dealership in Dubai. It does three things:

1. **Shows the dealership's real stock** (478 cars: 408 for sale, 70 sold, 18 brands) with photos and specifications.
2. **Lets a customer configure the car in 3D**: change the paint colour on a live 3D model, and choose wheels and aero kits from Dubai suppliers that list fitment for that exact car.
3. **Captures leads**: configurator and car-page enquiries, service and test-drive bookings, and customer accounts, all delivered to the dealership's CRM.
4. **Runs from a CRM** at `/admin/`: staff edit the stock, wheels and kits, work the lead pipeline and bookings, and see customers. Changes reach the website within a minute (see `docs/DEPLOY.md`).

The stock was imported from the client's own website (`exoticcars.ae`) with the client's permission. The site lists no prices, so cars show "Price on request".

---

## 2. Pages and screens

The app is a single page with a hash router. The landing screen opens onto Home; Home, Service, the concierge, VR and the account share the bottom **dock**.

| Route | Screen | What the customer does |
| --- | --- | --- |
| `#/` | **Landing** | Sees the EXOTIC wordmark, Dubai time, and a Ferrari, Bugatti or McLaren from stock on a spotlit 3D turntable (make above, model and year below). Turns the car by dragging the knob along the ring. Reads today's stock in three figures (cars for sale, makes, cars in 3D). Presses and holds the orb to enter, or taps **Showroom** at the top to go straight in. |
| `#/home` | **Home** | Greeting, the number of cars for sale, the concierge prompt, featured cars by make, shop by make, a make spotlight, new arrivals, body styles and recently sold. |
| `#/shop` | **Shop** | Switches between New arrival, Cars for sale and Previously sold. Searches by make or model. Filters by make, model, minimum year and maximum year. Scrolls a list of car cards. Cards with a matching 3D model show a **3D** chip. |
| `#/shop/<id>` | **Car detail** | Swipes through the photo gallery (for example 1 / 24), sees brand, title, price, and specs (year, mileage, engine, power, transmission, body, exterior, interior). Can book a viewing, or open the 3D configurator when one exists. |
| `#/shop/<id>/configure` | **Configurator** | Full-screen 3D view of the car with floating controls (section 3). Opened only for cars with a verified 3D model. |
| `#/service` | **Service** | Chooses a service, vehicle, date and time, and gives name, phone, email and notes. |
| `#/concierge` | **AI concierge** | Asks for a car in plain words and gets matching cars from stock. |
| `#/vr` | **VR & AR viewer** | Picks a car and launches a full-screen viewer that supports a VR headset or AR on a phone. |
| `#/account` | **Account** | Signs in with a name and email (no password; details stay in the browser) and changes settings. |

**Appointment services:** Test drive · Service & maintenance · Wheel & aero fitting · Paint protection & detailing · Configuration consultation.
**Appointment times:** 09:00, 10:00, 11:00, 12:00, 14:00, 15:00, 16:00, 17:00. The date cannot be earlier than today.

---

## 3. The configurator in detail

The 3D car fills the whole screen. Every control floats over it.

- **Left column ("Customise"):** small round buttons for **Paint**, **Wheels**, **Aero** and **Details**. Only the sections the car supports appear. The selected button grows and shows its name.
- **Right column:** the options for the chosen section, as small round dots. The selected dot is the largest and carries a ring and a tick. Hovered dots and their neighbours swell. Changing sections animates the dots in one after another.
- **Colour types:** Solid, Metallic and Matte, switched with one pill that cycles through them.
- **Top:** back button, camera (save image) and share (copy link). The title, subtitle and an "Active" chip show the current choice. Hovering a dot previews its name in that chip.
- **Views:** Side, Front, Rear, Top and Wheel camera positions.
- **Bottom:** a question button (opens the appointment form), a running price, the available 3D models, and a **swipe-to-enquire** bar.
- **Credit line:** every model shows its title, author, licence and a Sketchfab link.

| Section | Choices | What happens on the car |
| --- | --- | --- |
| Paint | Preset colours (gloss, metallic, matte), a custom colour picker, and "colour a single part" | Changes the body paint live. |
| Wheels | Wheel sets and singles from the supplier catalogue, with a finish colour | Goes on the quote. Rim colour changes live when the model has a clean rim material. |
| Aero | Body kits grouped by part (front lip, side skirts, wing, diffuser, full kit and so on) | Goes on the quote. |
| Details | Glass tint and brake caliper colours | Changes live when the model supports them. |

**Sharing:** every choice is stored in the web address (`#/shop/<id>/configure/<state>`). A configuration can be bookmarked, reloaded or sent to someone.

**Price:** the total adds up the wheels and kits chosen, in AED. The car's own price is not included because the dealership lists none. Prices can be hidden in Settings.

---

## 4. How the 3D works

- Models are embedded from **Sketchfab** through its Viewer API (`src/viewer/sketchfab.js`).
- The API can recolour materials and move the camera, but it cannot add geometry. So paint, glass tint and calipers are **live**, while wheels and kits are **chosen from the catalogue** and added to the quote.
- The car's axes are worked out from where its wheels sit, so "Side" is a true side view whichever way the author oriented the model. A soft floor shadow is placed from the same geometry.
- The body paint is found by trying, in order: material name, saturation, the busiest material, and finally sampling the visible car on screen.
- Because controls float over the car, the viewer is told which screen areas are covered and fits the car into the free space.

### 4.1 Choosing the right 3D model for each stock car

A pipeline picks the best model for each real car and rejects wrong ones. It is run by hand with these tools:

1. `tools/match-stock-models.mjs` searches Sketchfab and scores candidates on make, model, variant, year, quality and licence. Words that mark a different car (for example "XX", "Folgore", "GT3", "Black Series", "limousine") reject a model outright.
2. `tools/audit.html` loads each candidate in a browser to check that it actually renders.
3. `tools/apply-stock-models.mjs` combines both results into `public/data/stock-models.json`, best model first, preferring licences that allow commercial use.

**Result:** 373 of the 408 cars for sale have a verified 3D model. **35 have none by design**; they show photos only and no configurator rather than a wrong model.

---

## 5. Data

| File | Size | Contents |
| --- | --- | --- |
| `public/data/stock.json` | about 2.5 MB | 478 stock cars: id, title, brand, model, year, mileage, price, engine, power, cylinders, transmission, body, exterior, interior, doors, region, warranty, description, gallery, video, listing date, flags for new arrival, featured and sold. |
| `public/data/stock-models.json` | about 200 KB | For 373 cars, the verified 3D models (uid, name, author, licence, link, thumbnail). |
| `public/data/catalog.json` | about 3.4 MB | 500 vehicle generations with production years, factory wheel specification and fitment rules. |
| `public/data/products.json` | about 3.2 MB | 3,401 products: 2,388 wheels and 1,013 aero kits, with vendor, price in AED, images and the cars each fits. |
| `public/stock/*.webp` | 478 files | Cover photos downloaded and resized. Gallery photos stay linked to the dealership's own image addresses. |

**Stock by brand (478 cars):** Ferrari 126 · Rolls-Royce 97 · Lamborghini 73 · Mercedes-Benz 48 · Bentley 35 · Porsche 27 · Aston Martin 19 · Land Rover 19 · McLaren 10 · BMW 9 · Audi 3 · Maserati 3 · Bugatti 2 · Cadillac 2 · KTM 2 · Alfa Romeo 1 · Infiniti 1 · Brute 1.

**Largest parts suppliers in the catalogue:** APEX RACE (1,064) · NOVITEC (856) · TITAN7 (382) · Vorsteiner (263) · ADRO (191) · BBS (153) · UNPLUGGED PERFORMANCE (100) · GTK (57), among about 30 others.

### 5.1 Fitment checks

A wheel or kit is linked to a car only when the supplier's title names that car and the years overlap. Wheels whose bolt pattern contradicts the factory specification are rejected. Surcharges, spacers and bolts are not treated as wheels.

### 5.2 What is saved on the visitor's device, and what goes to the dealership

Sent to the dealership's API (`/api/v1`, stored in Netlify Blobs): enquiries (with the full 3D build), bookings and customer accounts (scrypt-hashed passwords, HttpOnly session cookie).

The browser stores:

- settings (dark appearance, hide prices, reduce motion),
- the signed-in name and email,
- a copy of the visitor's appointment requests for "Your requests",
- an outbox of enquiries and bookings made while offline, sent automatically later (each with its own reference, so a retry never duplicates it),
- device-only accounts made before the backend existed; they move to the server at the next sign-in.

### 5.3 Backend and CRM

One Netlify Function serves the API (`server/app.mjs`): public stock and products (CDN-cached for 30 seconds), enquiries, bookings, customer accounts, and staff routes for the CRM. Data lives in Netlify Blobs: the stock and catalogue as two documents guarded by entity tags (concurrent edits retry instead of overwriting), CRM records one per key. The first staff sign-in imports the built-in stock and catalogue. Contract: `docs/openapi.yaml`; design and security checklist: `specs/crm-backend_design.md`.

---

## 6. Design

- **Look:** light theme with a dark option, black ink, glass-effect floating controls, generous whitespace and no heavy text.
- **Typeface:** Jost.
- **Icons:** Lucide.
- **Dock:** a graphite glass capsule. The selected item opens into a rosso-red pill with its name, lit from within, and its light spills onto the page around the dock. The highlight travels on springs (its leading edge is thrown, the trailing edge follows), icons swell toward a mouse pointer, and a thumb can slide along the dock to choose (a label rides above it). Scrolling down tucks the dock behind a small handle. Arrow keys move between items. On the smallest phones (320px wide) the names move into tooltips.
- **Selected states:** every selected control (dock, tabs, chips, segmented controls, time slots) uses the same red fill with a rim and a two-stage glow; unselected siblings step back.
- **Motion:** spring-like growth on selected buttons and dots, staggered entrance of option dots, a pulse on the "Active" chip when it changes, swipe-to-confirm with spring-back. A "reduce motion" setting calms all of it.
- **Mobile-first:** designed at 390 × 844. On wider screens the controls scale up.

A Figma file with the eight mobile screens exists: https://www.figma.com/design/8tlb7YTRaU7bpCYxPz74M4

---

## 7. Technology

| Area | Choice |
| --- | --- |
| Language | Plain JavaScript (ES modules), no framework |
| Build tool | Vite 8 |
| Tests | Vitest 5 (95 tests: parsers, fitment checks, totals, share links, CRM fitment, imported data against the CRM schemas, share-link safety, and API integration against a local Blobs store) |
| Backend | Netlify Functions (v2) + Netlify Blobs, Zod validation, scrypt passwords, HMAC-signed cookies |
| CRM | `/admin/`, plain JavaScript, same fonts and rosso palette as the site, light and dark |
| 3D | Sketchfab Viewer API 1.12.1 |
| Icons | Lucide, Simple Icons (brand marks) |
| Fonts | Jost, Bodoni Moda, Instrument Sans, IBM Plex Mono through Fontsource |
| Image processing | sharp (build tools only) |
| Hosting | Netlify. `npm run build` produces `dist/` (website and CRM); Netlify bundles the API function. Deploy from Git or the CLI (`docs/DEPLOY.md`). A static-only upload still serves the showroom from built-in data. |

---

## 8. Folder map

```
index.html                  page shell
admin/index.html            CRM page shell (/admin/)
netlify.toml                build, function and CRM header settings
netlify/functions/api.mjs   the API function (/api/v1/*)
server/                     API: app.mjs (routes), auth, http, schemas, store, repo
vite.config.js              build settings (website + CRM; /api proxy for local dev)
src/
  admin/                    CRM: main.js (shell, router), api.js, ui.js, media.js, admin.css, views/
  main.js                   starts the app and loads styles
  app.js                    hash router
  pages/
    home.js                 home and dock
    shop.js                 shop list and car detail
    car.js                  full-screen configurator
  viewer/sketchfab.js       Sketchfab wrapper: materials, axes, cameras, paint detection
  state/
    build.js                paints, parts list, totals, share links (tested)
    settings.js             settings, signed-in user, appointments (browser storage)
    accounts.js             customer accounts (API first, device fallback)
    outbox.js               enquiries and bookings to the API, offline queue
  data/
    api.js                  API client for the website
    catalog.js              catalogue queries, fitment checks, labels
    stock.js                stock loading, model matching, filters
    brand-paths.json        brand mark drawings
  ui/                       dock, panels, swipe control, toast, icons, brand marks
  styles/                   main.css, configurator.css
public/data/                catalog, products, stock, stock-models (JSON)
public/stock/               478 cover photos
tools/                      data pipeline (section 9), dev-api.mjs, admin-hash.mjs
tests/                      build, products, fits (CRM fitment) and api (integration) tests
specs/                      backend and CRM design
docs/                       this document, DEPLOY.md, openapi.yaml
```

---

## 9. Data pipeline commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server at http://localhost:5173. |
| `npm run build` | Builds the static site into `dist/`. |
| `npm run preview` | Serves the built site locally. |
| `npm test` | Runs the 40 tests. |
| `npm run stock` | Re-imports the dealership stock (one request per second) and rebuilds `stock.json` and the cover photos. |
| `npm run harvest -- <host>` | Crawls a supplier's public product feed into a local cache. |
| `npm run db` | Builds the vehicle and product database and the two catalogue JSON files. |
| `npm run report` | Prints a fitment coverage report. |
| `node tools/match-stock-models.mjs` | Finds candidate 3D models for each stock car. |
| `tools/audit.html` | Render check of the candidates. Copy it into `public/` temporarily to run it, then remove it. |
| `node tools/apply-stock-models.mjs` | Writes the verified models to `public/data/stock-models.json`. |

---

## 10. Sources and licences

- **Stock, photos and specifications:** the client's own website, used with the client's permission.
- **Wheels and kits:** ATOMIC-SHOP and Al Khateeb (Dubai) and other suppliers, prices in AED as published.
- **Factory wheel fitment:** ANKUSI Wheel Fitment Dataset (CC BY 4.0).
- **Vehicle names:** NHTSA vPIC.
- **3D models:** Sketchfab. Each model is credited on screen with author, licence and link.
- **Brand marks:** Simple Icons (artwork CC0; the marks belong to their owners).
- **Fonts:** Jost (SIL Open Font Licence).

**Licence warning for 3D models.** 59 stock cars use a 3D model whose licence is non-commercial or editorial, because no better match exists. That is a risk for commercial use. Either replace those models, or get permission from their authors. The Urus default is one of them.

---

## 11. Known limits and next steps

- 35 cars for sale have no 3D model by design.
- Very detailed models (for example a 1.8-million-face Cullinan) can load slowly on phones, taking around 15 to 20 seconds in testing.
- Wheels and kits appear on the quote but are not drawn on the 3D car, because the viewer cannot add geometry.
- The CRM has one staff account (set by environment variables). Email or WhatsApp notifications for new leads are not sent yet; staff see them in the CRM (with a badge) and can export them.
- Prices are not listed by the dealership; staff can add them per car in the CRM.
- The CRM's dashboard and lists read every lead and booking on each request: fine for thousands of records, but a much larger volume would need index documents or a query database.
- Desktop layout has been checked less than the mobile layout.

**Suggested next steps:** email or WhatsApp alerts for new leads, more staff accounts with roles, replace the 59 non-commercially licensed models, add real prices, and finish the Figma file as reusable components with a dark theme.

---

## 12. Version history

| Commit | What it added |
| --- | --- |
| `0702208` | Shop with 3D configurator, dealership stock import and tools. |
| `248eac5` | Full-screen configurator with floating controls, small round animated buttons and dots, and verified stock 3D models (pull request 1 on GitHub). |
