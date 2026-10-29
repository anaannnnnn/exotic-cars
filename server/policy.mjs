import { z } from 'zod';
import { store } from './store.mjs';

/*
 * The dealership's rules, kept in one document the owner can change from the CRM (Settings -> Policy): who may give
 * what discount, how long a lead may wait for its next touch, how likely each stage is to close, the seasonal pattern of
 * the Dubai car market, and the planning horizons the forecast and the purchasing planner use.
 */
export const DEFAULT_POLICY = {
  branches: [{ id: 'dubai', name: 'Dubai showroom' }],
  defaultBranch: 'dubai',
  /* discount (% of the listed price) staff may give without approval; above it a manager approves. `maxPct` is the hard stop for everyone but the owner. */
  discount: { salesAutoPct: 0, managerAutoPct: 5, maxPct: 25, approvalValidHours: 72 },
  /* hours a lead may sit in each stage before its next touch is overdue */
  sla: { new: 2, contacted: 24, qualified: 48, negotiating: 72 },
  stageProbability: { new: 0.08, contacted: 0.15, qualified: 0.3, negotiating: 0.55 },
  /* January to December: how much stronger or weaker a month is than an average one (Dubai: busy cool season, quiet summer) */
  seasonality: [1.05, 1.0, 0.95, 0.9, 0.85, 0.75, 0.7, 0.72, 0.9, 1.1, 1.2, 1.25],
  /* purchasing: lead time to source a car, safety and cover in months of sales; the margin a purchase must earn, what it costs to prepare and to hold a car,
     the monthly budget for buying, and the most any one make may take of that budget */
  purchasing: { leadTimeMonths: 1.5, safetyMonths: 0.75, targetCoverMonths: 3, slowMoverDays: 90, targetMarginPct: 11, reconPct: 1.2, holdingPctPerMonth: 0.55, monthlyBudget: 20000000, maxMakeSharePct: 45 },
  conversionBaseline: 0.04,
  grossMarginPct: 9
};

const pct = z.coerce.number().min(0).max(100);
export const policyPatch = z.object({
  branches: z.array(z.object({ id: z.string().trim().regex(/^[a-z0-9-]{2,24}$/), name: z.string().trim().min(2).max(60) })).min(1).max(12),
  defaultBranch: z.string().trim().max(24),
  discount: z.object({ salesAutoPct: pct, managerAutoPct: pct, maxPct: pct, approvalValidHours: z.coerce.number().min(1).max(720) }).partial(),
  sla: z.object({ new: z.coerce.number().min(0.25).max(720), contacted: z.coerce.number().min(0.25).max(720), qualified: z.coerce.number().min(0.25).max(720), negotiating: z.coerce.number().min(0.25).max(720) }).partial(),
  stageProbability: z.object({ new: z.coerce.number().min(0).max(1), contacted: z.coerce.number().min(0).max(1), qualified: z.coerce.number().min(0).max(1), negotiating: z.coerce.number().min(0).max(1) }).partial(),
  seasonality: z.array(z.coerce.number().min(0.2).max(3)).length(12),
  purchasing: z.object({ leadTimeMonths: z.coerce.number().min(0).max(12), safetyMonths: z.coerce.number().min(0).max(12), targetCoverMonths: z.coerce.number().min(0.5).max(24), slowMoverDays: z.coerce.number().min(7).max(720), targetMarginPct: pct, reconPct: pct, holdingPctPerMonth: pct, monthlyBudget: z.coerce.number().min(0).max(1e10), maxMakeSharePct: z.coerce.number().min(5).max(100) }).partial(),
  conversionBaseline: z.coerce.number().min(0.001).max(1),
  grossMarginPct: pct
}).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to change');

const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? { ...base[k], ...v } : v;
  return out;
};

export async function getPolicy() {
  const saved = await store('system').get('policy', { type: 'json' }).catch(() => null);
  return merge(DEFAULT_POLICY, saved || {});
}

export async function setPolicy(patch) {
  const next = merge(await getPolicy(), patch);
  if (!next.branches.some((b) => b.id === next.defaultBranch)) next.defaultBranch = next.branches[0].id;
  await store('system').setJSON('policy', next);
  return next;
}
