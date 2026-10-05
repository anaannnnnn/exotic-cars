import { z } from 'zod';

/*
 * Every request body and query is parsed by one of these schemas before anything is stored. Unknown keys are
 * stripped; strings are trimmed and length-limited; links may only be https:// or an uploaded photo on this site.
 */
const str = (max, min = 0) => z.string({ required_error: 'Required', invalid_type_error: 'Required' }).trim()
  .min(min, min <= 1 ? 'Required' : `Use at least ${min} characters`).max(max, `Keep it under ${max} characters`);
/* an empty string clears a field (null); a missing key stays missing, so a partial update never wipes other fields */
const optStr = (max) => z.string().trim().max(max).optional().nullable().transform((v) => (v === undefined ? undefined : v || null));
export const safeUrl = z.string().trim().max(2048).refine((v) => /^https:\/\/[^\s<>"']+$/i.test(v) || /^\/api\/v1\/media\/[a-z0-9-]+$/i.test(v), 'Must be an https:// link or an uploaded photo');
const optUrl = safeUrl.optional().nullable();
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
  description: optStr(4000),
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
  website: honeypot
});

export const register = z.object({ name: str(80, 2), email, phone: z.union([phone, z.literal('')]).optional().nullable(), password: z.string().min(8, 'Use at least 8 characters').max(128) });
export const login = z.object({ email, password: z.string().min(1).max(128) });
export const staffLogin = z.object({ email: z.string().trim().max(254), password: z.string().min(1).max(256) });

/* ---------- staff updates ---------- */
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'negotiating', 'won', 'lost'];
export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no-show'];
export const leadPatch = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  name: str(80, 2).optional(),
  phone: phone.optional(),
  email: optEmail,
  message: optStr(2000),
  value: z.coerce.number().min(0).max(1e10).optional().nullable()
}).refine((o) => Object.keys(o).length > 0, 'Nothing to change');
export const appointmentPatch = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slot: str(16, 1).optional()
}).refine((o) => Object.keys(o).length > 0, 'Nothing to change');
export const note = z.object({ text: str(2000, 1) });
export const importBody = z.object({ mode: z.enum(['missing', 'replace']).default('missing'), what: z.array(z.enum(['cars', 'products'])).default(['cars', 'products']) });

/* ---------- queries ---------- */
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  make: z.string().trim().max(40).optional(),
  category: z.string().trim().max(20).optional(),
  sort: z.string().trim().max(30).optional()
});
