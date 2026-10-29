import { z } from 'zod';

/*
 * Every request body and query is parsed by one of these schemas before anything is stored. Unknown keys are
 * stripped; strings are trimmed and length-limited; links may only be https:// or an uploaded photo on this site.
 */
const str = (max, min = 0) => z.string({ required_error: 'Required', invalid_type_error: 'Required' }).trim()
  .min(min, min <= 1 ? 'Required' : `Use at least ${min} characters`).max(max, `Keep it under ${max} characters`);
/* an empty string clears a field (null); a missing key stays missing, so a partial update never wipes other fields */
const optStr = (max) => z.string().trim().max(max).optional().nullable().transform((v) => (v === undefined ? undefined : v || null));
/* links are only ever set through the DOM (href/src properties), never written into HTML, so an apostrophe is fine */
export const safeUrl = z.string().trim().max(2048).refine((v) => /^https:\/\/[^\s<>"]+$/i.test(v) || /^\/api\/v1\/media\/[a-z0-9-]+$/i.test(v), 'Must be an https:// link or an uploaded photo');
/* an emptied link field clears the link */
const optUrl = z.union([safeUrl, z.literal('')]).optional().nullable().transform((v) => (v === undefined ? undefined : v || null));
const phone = str(32, 6).refine((v) => v.replace(/\D/g, '').length >= 7, 'Enter a phone number we can reach');
const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address');
const optEmail = z.union([email, z.literal('')]).optional().nullable().transform((v) => (v === undefined ? undefined : v || null));
const honeypot = z.string().max(0, 'Not accepted').optional();
const thisYear = new Date().getFullYear();

/* ---------- inventory ---------- */
export const carFields = {
  title: str(140, 2),
  brand: str(40, 1),
  model: optStr(60),
  year: z.coerce.number().int().min(1950).max(thisYear + 2),
  km: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  price: z.coerce.number().min(0).max(1_000_000_000).optional().nullable(),
  engine: optStr(40),
  hp: optStr(40),
  cylinders: z.coerce.number().int().min(0).max(16).optional().nullable(),
  transmission: optStr(30),
  body: optStr(30),
  exterior: optStr(40),
  interior: optStr(40),
  doors: z.coerce.number().int().min(0).max(6).optional().nullable(),
  region: optStr(20),
  warranty: optStr(60),
  description: optStr(20000),   /* imported listings run to 10,000+ characters */
  subtitle: optStr(140),
  newArrival: z.boolean().optional(),
  featured: z.boolean().optional(),
  sold: z.boolean().optional(),
  hidden: z.boolean().optional(),
  video: optUrl,
  cover: optUrl,
  gallery: z.array(safeUrl).max(40).optional(),
  url: optUrl
};
export const carCreate = z.object(carFields);
export const carPatch = z.object(carFields).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to change');

/* ---------- products (wheels and body kits) ---------- */
export const productFields = {
  title: str(240, 2),
  vendor: str(60, 1),
  sku: optStr(80),
  url: optUrl,
  priceAED: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  available: z.boolean().optional(),
  category: z.enum(['wheel', 'kit']),
  subtype: optStr(40),
  material: optStr(60),
  images: z.array(safeUrl).max(20).optional(),
  fitment: optStr(240),
  fits: z.array(str(80, 1)).max(200).optional(),
  design: optStr(60),
  construction: optStr(40),
  centerLock: z.boolean().optional().nullable(),
  paintable: z.boolean().optional().nullable(),
  /* how the configurator draws a wheel, and its size */
  finish: z.object({
    name: optStr(40),
    color: z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Use a colour like #1a1a1a'),
    metalness: z.coerce.number().min(0).max(1).default(0.9),
    roughness: z.coerce.number().min(0).max(1).default(0.3)
  }).optional().nullable(),
  spec: z.object({
    diameter: z.coerce.number().min(13).max(26).optional().nullable(),
    diameterRear: z.coerce.number().min(13).max(26).optional().nullable(),
    width: z.coerce.number().min(4).max(15).optional().nullable(),
    widthRear: z.coerce.number().min(4).max(15).optional().nullable(),
    et: z.coerce.number().min(-80).max(120).optional().nullable(),
    pcd: z.string().trim().regex(/^([4-8]x\d{2,3}(\.\d+)?|centerlock)$/i, 'Use a bolt pattern like 5x114.3').optional().nullable().or(z.literal('').transform(() => null)),
    cb: z.coerce.number().min(40).max(130).optional().nullable(),
    set: z.boolean().optional().nullable()
  }).optional().nullable()
};
export const productCreate = z.object(productFields);
export const productPatch = z.object(productFields).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to change');

/* ---------- homepage promotions ---------- */
const promoHref = z.string().trim().max(2048).refine((v) => /^#\/[a-z0-9/?&=._%+-]*$/i.test(v) || /^https:\/\/[^\s<>\"]+$/i.test(v), 'Use a website route beginning #/ or an https:// link');
export const promotion = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{4,80}$/i),
  title: str(120, 2),
  eyebrow: optStr(60),
  body: optStr(220),
  brand: optStr(40),
  image: safeUrl,
  cta: str(40, 1).default('Explore'),
  href: promoHref.default('#/shop'),
  active: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(0)
});
export const promotionsPut = z.object({ items: z.array(promotion).max(20) });

/* ---------- public forms ---------- */
const configuration = z.object({
  paint: optStr(200),
  wheels: z.array(z.object({ id: str(300), title: str(300), qty: z.coerce.number().int().min(1).max(8).optional(), price: z.coerce.number().min(0).max(1e9).optional().nullable() })).max(10).optional(),
  kits: z.array(z.object({ id: str(300), title: str(300), price: z.coerce.number().min(0).max(1e9).optional().nullable() })).max(20).optional(),
  total: z.coerce.number().min(0).max(1e10).optional().nullable(),
  url: z.string().trim().max(4000).refine((v) => /^https?:\/\//i.test(v), 'Must be a link').optional().nullable()
});

export const leadCreate = z.object({
  ref: z.string().trim().regex(/^[A-Z]{2}-[A-Z0-9]{4,10}$/).optional(),
  type: z.enum(['configuration', 'viewing', 'general']).default('general'),
  name: str(80, 2),
  phone,
  email: optEmail,
  message: optStr(2000),
  car: z.object({ id: z.union([z.number().int(), z.string().max(80)]).optional().nullable(), title: str(160) }).optional().nullable(),
  configuration: configuration.optional().nullable(),
  source: optStr(60),
  website: honeypot
});

export const appointmentCreate = z.object({
  ref: z.string().trim().regex(/^[A-Z]{2}-[A-Z0-9]{4,10}$/).optional(),
  service: str(80, 2),
  car: optStr(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-05'),
  slot: str(16, 1),
  name: str(80, 2),
  phone,
  email: optEmail,
  notes: optStr(2000),
  ownedId: optStr(40),
  pickupAddress: optStr(300),
  website: honeypot
});

export const customerStaffCreate = z.object({ name: str(80, 2), email, phone: z.union([phone, z.literal('')]).optional().nullable() });
export const register = z.object({ name: str(80, 2), email, phone: z.union([phone, z.literal('')]).optional().nullable(), password: z.string().min(8, 'Use at least 8 characters').max(128) });
export const login = z.object({ email, password: z.string().min(1).max(128) });
export const staffLogin = z.object({ email: z.string().trim().max(254), password: z.string().min(1).max(256) });
const staffPassword = z.string().min(10, 'Use at least 10 characters').max(256);
export const staffSetup = z.object({ email, password: staffPassword });
export const passwordChange = z.object({ current: z.string().min(1, 'Required').max(256), next: staffPassword });

/* ---------- staff updates ---------- */
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'negotiating', 'won', 'lost'];
export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no-show'];
export const leadPatch = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  name: str(80, 2).optional(),
  phone: phone.optional(),
  email: optEmail,
  message: optStr(2000),
  value: z.coerce.number().min(0).max(1e10).optional().nullable(),
  assignee: z.string().trim().max(254).optional().nullable().transform((v) => (v === undefined ? undefined : v || null)),
  branch: z.string().trim().max(24).optional()
}).refine((o) => Object.keys(o).length > 0, 'Nothing to change');
export const appointmentPatch = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slot: str(16, 1).optional()
}).refine((o) => Object.keys(o).length > 0, 'Nothing to change');
export const note = z.object({ text: str(2000, 1) });
export const importBody = z.object({ mode: z.enum(['missing', 'replace']).default('missing'), what: z.array(z.enum(['cars', 'products'])).default(['cars', 'products']) });

/* ---------- home advertisements and transaction ledger ---------- */
export const adSlide = z.object({
  image: safeUrl,
  text: optStr(160),
  font: z.enum(['Instrument Sans Variable', 'Archivo Variable', 'Michroma']).default('Instrument Sans Variable'),
  active: z.boolean().default(true)
});
export const transactionCreate = z.object({
  type: z.enum(['sale', 'purchase']),
  carId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(1e10),
  date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
  salesperson: optStr(100),
  counterparty: optStr(120),
  notes: optStr(1000)
});
export const transactionQuery = z.object({
  type: z.enum(['sale', 'purchase']).optional(), month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(1950).max(thisYear + 2).optional(),
  car: z.string().trim().max(30).optional(), brand: z.string().trim().max(40).optional(),
  salesperson: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(500)
});

/* ---------- queries ---------- */
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  make: z.string().trim().max(40).optional(),
  category: z.string().trim().max(20).optional(),
  sort: z.string().trim().max(30).optional(),
  mine: z.enum(['1']).optional(),
  assignee: z.string().trim().max(254).optional(),
  branch: z.string().trim().max(24).optional(),
  band: z.enum(['hot', 'warm', 'cool']).optional(),
  sla: z.enum(['overdue', 'due', 'ok']).optional(),
  source: z.string().trim().max(30).optional(),
  approval: z.string().trim().max(20).optional()
});

/* ---------- the deal desk, the team, the workshop ---------- */
export const SOURCES = ['website', 'configurator', 'phone', 'walk-in', 'whatsapp', 'instagram', 'referral', 'event', 'other'];
export const leadStaffCreate = z.object({
  name: str(80, 2), phone, email: optEmail, message: optStr(2000),
  source: z.enum(SOURCES).default('phone'),
  type: z.enum(['configuration', 'viewing', 'general']).default('viewing'),
  car: z.object({ id: z.union([z.number().int(), z.string().max(80)]).optional().nullable(), title: str(160) }).optional().nullable(),
  budget: z.coerce.number().min(0).max(1e10).optional().nullable(),
  assignee: z.string().trim().max(254).optional().nullable(),
  branch: z.string().trim().max(24).optional().nullable(),
  status: z.enum(['new', 'contacted', 'qualified']).optional(),
  confirmDuplicate: z.boolean().optional()
});
export const dealInput = z.object({
  carId: z.union([z.number().int(), z.string().max(40)]).optional().nullable(),
  listPrice: z.coerce.number().min(1).max(1e10).optional(),
  finalPrice: z.coerce.number().min(0).max(1e10).optional(),
  reason: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  payment: z.enum(['cash', 'finance', 'lease', 'part-exchange']).optional().nullable(),
  deposit: z.coerce.number().min(0).max(1e10).optional().nullable(),
  tradeIn: z.object({ desc: optStr(200), value: z.coerce.number().min(0).max(1e10).optional().nullable() }).optional().nullable(),
  notes: optStr(2000)
});
export const discountDecision = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional().nullable() });
export const touchInput = z.object({
  kind: z.enum(['call', 'whatsapp', 'email', 'visit']),
  outcome: z.enum(['connected', 'no-answer', 'left-message', 'not-interested', 'visit-booked', 'offer-made']).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  nextAt: z.string().trim().max(40).optional().nullable().refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Choose a real date and time'),
  nextText: z.string().trim().max(160).optional().nullable()
});
export const ROLES = ['owner', 'manager', 'sales', 'service'];
export const teamCreate = z.object({ email, name: str(80, 2), role: z.enum(ROLES), branch: z.string().trim().max(24).optional().nullable(), password: staffPassword });
export const teamPatch = z.object({ name: str(80, 2), role: z.enum(ROLES), branch: z.string().trim().max(24).nullable(), active: z.boolean(), password: staffPassword }).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to change');
export const demandInput = z.object({
  query: z.string().trim().max(200).optional().nullable(), brand: z.string().trim().max(40).optional().nullable(), body: z.string().trim().max(30).optional().nullable(), colour: z.string().trim().max(30).optional().nullable(),
  yearFrom: z.coerce.number().int().min(1950).max(thisYear + 2).optional().nullable(), yearTo: z.coerce.number().int().min(1950).max(thisYear + 2).optional().nullable(), source: z.enum(['concierge', 'shop', 'other']).default('other'), website: honeypot
});
export const JOB_STATUS = ['requested', 'scheduled', 'received', 'inspecting', 'quoted', 'approved', 'in-progress', 'qc', 'ready', 'delivered', 'cancelled'];
export const jobPatch = z.object({
  status: z.enum(JOB_STATUS), note: z.string().trim().max(500).nullable(), assignee: z.string().trim().max(254).nullable(),
  eta: z.string().trim().max(40).nullable(), courtesy: z.boolean(), description: optStr(2000),
  quote: z.object({ items: z.array(z.object({ label: str(120, 1), qty: z.coerce.number().int().min(1).max(100).optional(), price: z.coerce.number().min(0).max(1e8) })).min(1).max(40), note: optStr(500) }),
  pickup: z.object({ needed: z.boolean(), address: optStr(300) }).partial(),
  warranty: z.object({ covered: z.boolean() }).partial(),
  invoice: z.object({ total: z.coerce.number().min(0).max(1e9), paid: z.boolean() }).partial()
}).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to change');
export const trackQuery = z.object({ ref: z.string().trim().min(4).max(20), phone: z.string().trim().min(3).max(32) });
export const quoteDecision = z.object({ decision: z.enum(['approved', 'declined']), ref: z.string().trim().max(20).optional(), phone: z.string().trim().max(32).optional() });
export const handoverInput = z.object({ vin: optStr(32), plate: optStr(16), km: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(), warrantyText: optStr(80), plan: z.enum(['essential', 'complete', 'concierge']).optional().nullable() });
export const claimInput = z.object({ code: z.string().trim().min(6).max(20) });
export const plannerAsk = z.object({ q: z.string().trim().min(2).max(200) });
export const forecastQuery = z.object({ horizon: z.coerce.number().int().min(3).max(12).default(6) });
export const forecastCalc = z.object({
  history: z.array(z.coerce.number().min(0).max(10000)).min(1).max(24),
  stock: z.coerce.number().min(0).max(100000).default(0), safety: z.coerce.number().min(0).max(100000).default(0),
  leadDays: z.coerce.number().min(0).max(365).default(45), periodDays: z.coerce.number().min(7).max(730).default(90),
  price: z.coerce.number().min(1).max(1e9), cost: z.coerce.number().min(0).max(1e9).default(0), recon: z.coerce.number().min(0).max(1e9).default(0),
  discountPct: z.coerce.number().min(0).max(60).default(0), holdingPct: z.coerce.number().min(0).max(20).default(0.55), targetMarginPct: z.coerce.number().min(0).max(80).default(11),
  month: z.coerce.number().int().min(0).max(11).default(new Date().getMonth()), event: z.string().trim().max(30).default('none')
});
export const forecastSuggest = z.object({ brand: z.string().trim().min(1).max(60), model: z.string().trim().max(80).optional() });
export const purchasingQuery = z.object({ budget: z.coerce.number().min(0).max(1e10).optional(), appetite: z.enum(['cautious', 'balanced', 'bold']).default('balanced'), cover: z.coerce.number().min(0.5).max(24).optional() });
export const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(40), offset: z.coerce.number().int().min(0).default(0), by: z.string().trim().max(254).optional(), action: z.string().trim().max(60).optional(), entity: z.string().trim().max(30).optional(), q: z.string().trim().max(100).optional(), since: z.string().trim().max(40).optional(), mine: z.enum(['1']).optional() });

/* ---------- the AI concierge ---------- */
const turn = z.object({ from: z.enum(['you', 'ai']), text: z.string().trim().max(700) });
export const conciergeAsk = z.object({ text: z.string().trim().min(1).max(800), history: z.array(turn).max(12).optional().default([]), focus: z.union([z.number().int(), z.string().max(20)]).optional().nullable() });
export const conciergeVoice = z.object({ audio: z.string().min(100).max(4_000_000), mime: z.string().trim().regex(/^audio\/[a-z0-9.+-]+(;.*)?$/i).max(80), history: z.array(turn).max(12).optional().default([]), focus: z.union([z.number().int(), z.string().max(20)]).optional().nullable() });
export const conciergeSpeak = z.object({ text: z.string().trim().min(1).max(500) });
