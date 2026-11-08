import { describe, expect, it } from 'vitest';
import { CHANNEL_GROUPS, channelTiles, todayFor } from './pathTrailChannels';
import { HEXAGON_CATALOGUE } from '../../shared/hexagon-registry/catalogue.js';

const cat = HEXAGON_CATALOGUE as { id: string; channel: string; arrival: string; status: string; plan?: string }[];

describe('channel groups use exactly the catalogue members', () => {
  for (const g of CHANNEL_GROUPS) {
    it(`${g.title}: the row shape adds up to the tile count and no row is wider than 3`, () => {
      const n = channelTiles(g.key).length;
      expect(g.rows.reduce((a, b) => a + b, 0)).toBe(n);
      g.rows.forEach((r) => { expect(r).toBeGreaterThanOrEqual(1); expect(r).toBeLessThanOrEqual(3); });
    });
    it(`${g.title}: no tile is repeated`, () => {
      const ids = channelTiles(g.key).map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
  for (const key of ['email', 'whatsapp', 'messenger']) {
    it(`${key}: every catalogue tile is there, none invented, in arrival order`, () => {
      const real = cat.filter((h) => h.channel === key);
      expect(channelTiles(key).map((t) => t.id)).toEqual(real.map((h) => h.id));
      const arrivals = real.map((h) => h.arrival);
      expect([...arrivals].sort()).toEqual(arrivals);
    });
  }
  it('has 21 email, 22 WhatsApp and 8 Messenger tiles, as the catalogue says', () => {
    expect(channelTiles('email')).toHaveLength(21);
    expect(channelTiles('whatsapp')).toHaveLength(22);
    expect(channelTiles('messenger')).toHaveLength(8);
  });
});

describe('captions tell the truth about each tile today', () => {
  it('never shows a not-planned tile as coming', () => {
    expect(todayFor({ status: 'new', plan: 'not_planned' })).toEqual({ state: 'notyet', caption: 'Not planned today' });
    expect(todayFor({ status: 'new', plan: 'later' })).toEqual({ state: 'notyet', caption: 'Later' });
  });
  it('holds a live tile and calls an open new tile planned', () => {
    expect(todayFor({ status: 'defined' }).state).toBe('held');
    expect(todayFor({ status: 'new' })).toEqual({ state: 'notyet', caption: 'Planned' });
  });
  it('all WhatsApp and Messenger tiles are not planned today (owner decision MPC-8689)', () => {
    for (const key of ['whatsapp', 'messenger']) for (const t of channelTiles(key)) expect(t.caption).toBe('Not planned today');
  });
  it('shows exactly the live email tiles as held today', () => {
    const held = channelTiles('email').filter((t) => t.today === 'held').map((t) => t.id);
    expect(held.sort()).toEqual(cat.filter((h) => h.channel === 'email' && h.status === 'defined').map((h) => h.id).sort());
  });
});
