import { api, unavailable } from './api.js';

/*
 * After-sale services for the signed-in customer (garage, workshop jobs) and for guests who follow a job with its
 * reference and the last four digits of their phone. Every call resolves to null when the backend is not reachable, so
 * the pages simply show their static parts.
 */
const soft = (p) => p.catch((e) => { if (unavailable(e) || e.status === 401) return null; throw e; });

export const garage = () => soft(api('auth/garage')).then((r) => r?.data || null);
export const jobs = () => soft(api('auth/jobs')).then((r) => r?.data || null);
export const claim = (code) => api('auth/garage/claim', { method: 'POST', body: { code } }).then((r) => r.car);
export const track = (ref, phone) => api(`track?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`).then((r) => r.job);
export const decide = (job, decision, guest) => (guest
  ? api('track/quote', { method: 'POST', body: { decision, ref: guest.ref, phone: guest.phone } })
  : api(`auth/jobs/${encodeURIComponent(job.ref)}/quote`, { method: 'POST', body: { decision } })).then((r) => r.job);
export const catalogue = () => soft(api('service/catalogue'));

/** What each step means to the customer, in the words the app shows. */
export const STEP = {
  requested: ['Request received', 'We have your request. The team will confirm the booking shortly.'],
  scheduled: ['Booked in', 'Your slot is confirmed. Bring the car at the agreed time, or we collect it.'],
  received: ['Car checked in', 'Your car is with us. The inspection starts next.'],
  inspecting: ['Being inspected', 'A technician is going through the car and will prepare a written quote.'],
  quoted: ['Quote ready', 'Review the quote below. Nothing more is done until you approve it.'],
  approved: ['Quote approved', 'Thank you. The work is about to start.'],
  'in-progress': ['Work in progress', 'The work is under way. We will note each step here.'],
  qc: ['Quality check', 'The work is done and a second technician is checking it.'],
  ready: ['Ready for you', 'Your car is ready. Collect it, or we bring it back to you.'],
  delivered: ['Delivered', 'Your car is back with you. The visit is saved in your service history.'],
  cancelled: ['Cancelled', 'This job was cancelled. Contact us if that is a surprise.']
};
export const FLOW = ['requested', 'received', 'inspecting', 'quoted', 'approved', 'in-progress', 'qc', 'ready', 'delivered'];
