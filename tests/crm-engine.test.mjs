import { describe, it, expect } from 'vitest';
import { projectSeries } from '../server/forecast.mjs';
import { scoreLead, slaOf } from '../server/deals.mjs';
import { DEFAULT_POLICY } from '../server/policy.mjs';

const season = DEFAULT_POLICY.seasonality;
const month = (y, m) => new Date(Date.UTC(y, m, 1));

describe('forecast engine', () => {
  it('projects a flat series flat, reshaped by the season', () => {
    const out = projectSeries([20, 20, 20, 20, 20, 20], month(2026, 8), season, 3);   /* last month September; next: Oct, Nov, Dec */
    expect(out.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(out.months[2].value).toBeGreaterThan(out.months[0].value);                   /* December is stronger than October */
    expect(out.confidence).toBeGreaterThan(0.5);
  });
  it('keeps a trend modest and never negative', () => {
    const up = projectSeries([2, 4, 6, 8, 10, 12], month(2026, 2), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 6);
    expect(up.slope).toBeLessThanOrEqual(up.level * 0.18 + 1e-9);
    const down = projectSeries([12, 8, 4, 2, 1, 0], month(2026, 2), season, 6);
    down.months.forEach((m) => { expect(m.value).toBeGreaterThanOrEqual(0); expect(m.lo).toBeGreaterThanOrEqual(0); });
  });
  it('is less sure of an erratic or short history', () => {
    const steady = projectSeries([10, 10, 11, 10, 10, 11], month(2026, 5), season, 3).confidence;
    const wild = projectSeries([1, 30, 2, 25, 0, 40], month(2026, 5), season, 3).confidence;
    const short = projectSeries([10, 10], month(2026, 5), season, 3).confidence;
    expect(wild).toBeLessThan(steady); expect(short).toBeLessThan(steady);
  });
});

describe('lead score', () => {
  const base = { id: 'x', status: 'new', createdAt: new Date().toISOString(), source: 'website', type: 'general', message: '' };
  it('rewards intent and explains itself', () => {
    const cold = scoreLead({ ...base, message: 'just looking, maybe later' }, { policy: DEFAULT_POLICY });
    const hot = scoreLead({ ...base, source: 'walk-in', type: 'configuration', message: 'ready to pay cash today', status: 'negotiating', email: 'a@b.co' }, { policy: DEFAULT_POLICY, car: { price: 1_500_000 }, booked: true });
    expect(hot.score).toBeGreaterThan(cold.score);
    expect(hot.band).toBe('hot');
    expect(hot.reasons.length).toBeGreaterThan(2);
    expect(scoreLead(base, { policy: DEFAULT_POLICY }).next).toMatch(/Call within/);
  });
  it('is deterministic and bounded', () => {
    const a = scoreLead({ ...base, status: 'qualified' }, { policy: DEFAULT_POLICY, nowMs: 1e13 });
    const b = scoreLead({ ...base, status: 'qualified' }, { policy: DEFAULT_POLICY, nowMs: 1e13 });
    expect(a).toEqual(b); expect(a.score).toBeGreaterThanOrEqual(1); expect(a.score).toBeLessThanOrEqual(99);
  });
});

describe('SLA', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const lead = (status, at, extra = {}) => ({ status, createdAt: at, ...extra });
  it('flags a lead nobody touched in time', () => {
    expect(slaOf(lead('new', '2026-10-27T10:30:00Z'), DEFAULT_POLICY, now).state).toBe('due');       /* new: 2 h allowed, 30 min left */
    expect(slaOf(lead('new', '2026-10-27T08:00:00Z'), DEFAULT_POLICY, now).state).toBe('overdue');
    expect(slaOf(lead('new', '2026-10-27T11:59:00Z'), DEFAULT_POLICY, now).state).toBe('ok');
  });
  it('a planned follow-up replaces the stage deadline, and a touch resets it', () => {
    expect(slaOf(lead('contacted', '2026-10-01T00:00:00Z', { nextAction: { at: '2026-10-28T09:00:00Z' } }), DEFAULT_POLICY, now).state).toBe('ok');
    expect(slaOf(lead('contacted', '2026-10-01T00:00:00Z', { lastTouchAt: '2026-10-27T11:00:00Z' }), DEFAULT_POLICY, now).state).toBe('ok');
    expect(slaOf(lead('won', '2026-10-01T00:00:00Z'), DEFAULT_POLICY, now).state).toBe('closed');
  });
});
