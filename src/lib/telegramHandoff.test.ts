import { describe, expect, it } from 'vitest';
import { footprintSummary } from '../../shared/hexagon-registry/footprint.js';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { isHandoffRequest, parseHandoff } from './telegramHandoff';

// MPC-8689: the web side of the handoff.
describe('telegram handoff (web side)', () => {
  it('only a ?handoff=1 page asks the server', () => {
    expect(isHandoffRequest('?handoff=1')).toBe(true);
    expect(isHandoffRequest('')).toBe(false);
    expect(isHandoffRequest('?handoff=0')).toBe(false);
    expect(isHandoffRequest('?handoff=true')).toBe(false);
  });
  it('keeps only well-formed ids and drops anything unexpected', () => {
    const ok = parseHandoff({ channels: [{ channel: 'telegram', checked_ids: ['tg.username', 'tg.bio', 'tg.bio', '<script>', 5, 'x'.repeat(200)], scan_at: '2026-10-28T10:00:00Z' }] });
    expect(ok).toEqual({ ids: ['tg.username', 'tg.bio'], scanAt: '2026-10-28T10:00:00Z' });
    expect(parseHandoff(null).ids).toEqual([]);
    expect(parseHandoff({ channels: 'x' }).ids).toEqual([]);
    expect(parseHandoff({ channels: [{ channel: 'web', checked_ids: ['location'] }] }).ids).toEqual([]);
  });
  it('merged with the web scan: 54 web + 30 Telegram = 84 of 366 checked, 282 still to review', () => {
    const tg = Array.from({ length: 30 }, (_, i) => `tg.x${i}`); // ids outside the catalogue never count, so use the real ones below
    expect(footprintSummary(tg).checked).toBe(0);
    const real = [
      'numeric_id', 'first_name', 'last_name', 'username', 'language', 'message_time', 'message_text', 'message_counter', 'update_counter', 'bio', 'birthday', 'photo_current', 'photo_history',
      'photo_fingerprint', 'extra_usernames', 'premium', 'emoji_status', 'profile_colour', 'profile_background', 'gift_settings', 'business_intro', 'business_location', 'business_hours',
      'personal_channel', 'channel_posts', 'forward_privacy', 'voice_restriction', 'phone_shared', 'location_shared', 'group_role',
    ].map((k) => `tg.${k}`);
    const s = footprintSummary([...HEXAGONS.map((h: { id: string }) => h.id), ...real]);
    expect([s.checked, s.toReview]).toEqual([84, 282]);
  });
});
