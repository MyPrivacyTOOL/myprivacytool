import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FootprintPathHost from './FootprintPathHost';

// MPC-10621: the live path reads the dashboard's allow_listed_test_account flag. A real sender sees 4 arrival prints, a test account 5, and
// anything missing or odd falls back to a real user. The flag is the only thing read; no list of ids is ever in the response or on the page.
vi.mock('@/lib/telegramHandoff', () => ({ useTelegramHandoff: () => ({ ids: [], scanAt: null }) }));
const recipientFetch = vi.fn();
vi.mock('@/lib/recipientClient', () => ({ recipientFetch: (...a: unknown[]) => recipientFetch(...a) }));

const hx = (id: string, value: string) => ({ id, state: 'returned', value });
const HEXES = [hx('tg.username', '@krispyking5'), hx('tg.first_name', 'Krispy'), hx('tg.last_name', 'King'), hx('tg.language', 'en'), hx('tg.numeric_id', '6889701828'), hx('tg.photo_current', 'photo')];
const answer = (baseline: Record<string, unknown>) => recipientFetch.mockResolvedValue({ ok: true, json: async () => ({ baseline }) });
const prints = () => screen.getByTestId('path-behind').querySelectorAll('[data-print]');

beforeEach(() => { window.history.pushState({}, '', '/?path=1'); recipientFetch.mockReset(); });
afterEach(() => { window.history.pushState({}, '', '/'); });

describe('FootprintPathHost: live 4 versus 5 prints', () => {
  it('a real sender (flag false) sees 4 prints and no public-profile print', async () => {
    answer({ state: 'available', hexagons: HEXES, allow_listed_test_account: false });
    render(<FootprintPathHost />);
    await waitFor(() => expect(screen.queryByTestId('path-sample')).toBeNull());
    expect(prints()).toHaveLength(4);
    expect(screen.getByTestId('path-badge')).toHaveTextContent('4 things known about you');
  });
  it('an allow-listed test account (flag true) sees 5 prints', async () => {
    answer({ state: 'available', hexagons: HEXES, allow_listed_test_account: true });
    render(<FootprintPathHost />);
    await waitFor(() => expect(screen.getByTestId('print-profile')).toBeInTheDocument());
    expect(prints()).toHaveLength(5);
    expect(screen.getByTestId('path-badge')).toHaveTextContent('5 things known about you');
  });
  it.each([['missing', undefined], ['a string', 'true'], ['a number', 1]])('a flag that is %s counts as a real user (4 prints)', async (_n, flag) => {
    answer({ state: 'available', hexagons: HEXES, ...(flag === undefined ? {} : { allow_listed_test_account: flag }) });
    render(<FootprintPathHost />);
    await waitFor(() => expect(screen.queryByTestId('path-sample')).toBeNull());
    expect(prints()).toHaveLength(4);
  });
  it('asks only the dashboard, and nothing about an allow-list reaches the page', async () => {
    answer({ state: 'available', hexagons: HEXES, allow_listed_test_account: true });
    render(<FootprintPathHost />);
    await waitFor(() => expect(screen.getByTestId('print-profile')).toBeInTheDocument());
    expect(recipientFetch).toHaveBeenCalledWith('cloudflare-edge', '/api/dashboard', expect.anything(), ['page_load']);
    expect(document.body.textContent).not.toMatch(/allow.?list|PROBE_TELEGRAM/i);
  });
});
