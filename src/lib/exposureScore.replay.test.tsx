// MPC-7471-F4: one synthetic scan replayed through every consumer of the exposure score:
// page ring -> popup -> PDF -> JSON export -> baseline (mpt-leads Worker) -> saved scan -> report JSON (scan-report Worker code).
// All of them must show the same number, band, coverage and version for identical input. Synthetic data only; nothing leaves the test.
//
// Hand calculation of the expected values (so the test pins real numbers, not just agreement):
//   found:  location (device, sev 2), canvas-fingerprint (2), webrtc-leak (3), timezone-locale (2), screen-fingerprint (1)
//   clear:  cookies-status (storage 1), localstorage-status (1), mixed-content (security 1), https-status (1)
//   not checked: font-detection ("0 fonts"), google-services (the site cannot check it), dns-leak ("No Leak Detected")
//   E_device = 2/2 = 100, E_fingerprint = 8/8 = 100, E_storage = 0, E_security = 0; weights 5, 25, 10, 15 (sum 55)
//   S = round_half_up((5*100 + 25*100) / 55) = round_half_up(54.545...) = 55  -> Medium
//   coverage = round_half_up(100 * 9 / 54) = round_half_up(16.67) = 17
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinalSummaryPanel from '@/components/FinalSummaryPanel';
import RiskScore from '@/components/RiskScore';
import EmailCaptureModal from '@/components/EmailCaptureModal';
import type { HexagonData } from '@/lib/deviceDetection';
import { exposureForPage } from '@/lib/exposureScore';
import { toPayload } from '@/lib/webScan';
import { getHexagon } from '../../shared/hexagon-registry/registry.js';
import { SCORE_VERSION } from '../../shared/hexagon-registry/score.js';
import worker from '../../workers/mpt-leads/worker.js';
import { WEB_HEXAGONS, normaliseHexagons, buildReportJson } from '../../workers/scan-report/lib/reportHex.js';

const modalProps: Record<string, unknown>[] = [];
vi.mock('@/components/EmailCaptureModal', async (orig) => {
  const real = await orig<typeof import('@/components/EmailCaptureModal')>();
  return { default: (p: Record<string, unknown>) => { modalProps.push(p); return null; }, __real: real.default };
});

const pdfTexts: string[] = [];
vi.mock('jspdf', () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    lastAutoTable = { finalY: 100 };
    text(t: string | string[]) { pdfTexts.push(...[t].flat().map(String)); }
    splitTextToSize(t: string) { return [t]; }
    output() { return new ArrayBuffer(0); }
    save() {}
    addPage() {} circle() {} rect() {} roundedRect() {} setFillColor() {} setFont() {} setFontSize() {} setTextColor() {} setDrawColor() {} setLineWidth() {} line() {}
  },
}));
vi.mock('jspdf-autotable', () => ({ default: () => undefined }));

afterEach(() => { cleanup(); modalProps.length = 0; pdfTexts.length = 0; vi.unstubAllGlobals(); });

const hx = (id: string, value: string): HexagonData => ({
  id, label: getHexagon(id)!.label, value, icon: '⬢', confidence: 90, risk: '', confirmed: true, category: getHexagon(id)!.category as HexagonData['category'],
});
const SCAN: HexagonData[] = [
  hx('location', 'Springfield, Exampleshire'), hx('canvas-fingerprint', 'a1b2c3d4e5f6'), hx('webrtc-leak', 'Leak: 203.0.113.9'),
  hx('timezone-locale', 'Europe/London'), hx('screen-fingerprint', '1920x1080'),
  hx('cookies-status', 'Empty'), hx('localstorage-status', 'Empty'), hx('mixed-content', 'None'), hx('https-status', 'Secure (HTTPS)'),
  hx('font-detection', '0 fonts'), hx('google-services', 'Signed in'), hx('dns-leak', 'No Leak Detected'),
];
const EXPECTED = { score: 55, band: 'medium', coverage: 17, checked: 9, found: 5, clear: 4, notChecked: 3 };

describe('exposure-v1 replay across every consumer', () => {
  it('the shared function gives the hand-calculated result', () => {
    const r = exposureForPage(SCAN, true);
    expect(r.score_version).toBe(SCORE_VERSION);
    expect(r.score).toBe(EXPECTED.score);
    expect(r.band).toBe(EXPECTED.band);
    expect(r.coverage).toEqual({ checked: EXPECTED.checked, total: 54, percent: EXPECTED.coverage });
    expect(r.counts).toMatchObject({ found: EXPECTED.found, clear: EXPECTED.clear, not_checked: EXPECTED.notChecked });
    expect(r.provisional).toBe(false);
  });

  it('page ring: same number; provisional while the scan is unfinished, not once complete', () => {
    const { container, unmount } = render(<RiskScore confirmed={SCAN.length} total={SCAN.length} hexagons={SCAN} />);
    expect(container.textContent).toContain(String(EXPECTED.score));
    expect(container.textContent).toContain('Medium exposure');
    expect(container.textContent).not.toContain('provisional');
    unmount();
    const mid = render(<RiskScore confirmed={5} total={54} hexagons={SCAN} />);
    expect(mid.container.textContent).toContain(String(EXPECTED.score));
    expect(mid.container.textContent).toContain('(provisional)');
  });

  it('popup: score, band, coverage on screen and the same values handed to the email modal', () => {
    const { container } = render(<FinalSummaryPanel hexagons={SCAN} confirmedCount={SCAN.length} />);
    const text = container.textContent ?? '';
    expect(text).toContain(`${EXPECTED.score}/100`);
    expect(text).toContain('Medium exposure');
    expect(text).toContain(`${EXPECTED.coverage}%Coverage`);
    expect(text).not.toMatch(/Risk Score|Overall Privacy Risk/);
    return waitFor(() => {
      const p = modalProps.at(-1)!;
      expect(p).toMatchObject({ riskScore: EXPECTED.score, scoreVersion: SCORE_VERSION, coveragePercent: EXPECTED.coverage });
      expect(p.categoryScores).toEqual({ device: 100, fingerprint: 100, storage: 0, security: 0 });
    }, { timeout: 3000 });
  });

  it('PDF and JSON export carry the same score, band, coverage and version', async () => {
    const blobs: string[] = [];
    vi.stubGlobal('Blob', class { constructor(parts: BlobPart[]) { blobs.push(String(parts[0])); } });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<FinalSummaryPanel hexagons={SCAN} confirmedCount={SCAN.length} />);

    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }));
    await waitFor(() => expect(pdfTexts.length).toBeGreaterThan(5));
    expect(pdfTexts).toContain(String(EXPECTED.score));
    expect(pdfTexts).toContain(`${EXPECTED.coverage}%`);
    expect(pdfTexts).toContain('Exposure score');
    expect(pdfTexts).toContain('Coverage');
    expect(pdfTexts.some((t) => t.includes('Medium exposure') && t.includes(SCORE_VERSION))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /export json/i }));
    const json = JSON.parse(blobs.at(-1)!);
    expect(json.summary).toMatchObject({ scoreVersion: SCORE_VERSION, exposureScore: EXPECTED.score, band: EXPECTED.band, provisional: false, coveragePercent: EXPECTED.coverage, itemsChecked: EXPECTED.checked, itemsTotal: 54 });
    expect(json.summary).not.toHaveProperty('overallPrivacyRisk');
    expect(json.summary).not.toHaveProperty('trackingExposure');
  });

  it('baseline: the modal posts the same score with its version and the Worker stores exactly that, tagged', async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ success: true }), { status: 200 }); }));
    const Real = (await import('@/components/EmailCaptureModal') as unknown as { __real: typeof EmailCaptureModal }).__real;
    const r = exposureForPage(SCAN, true);
    const user = userEvent.setup();
    render(<Real riskScore={r.score} scoreVersion={r.score_version} coveragePercent={r.coverage.percent} categoryScores={{ device: 100, fingerprint: 100, storage: 0, security: 0 }} confirmedCount={SCAN.length} onClose={() => {}} onSubmit={() => {}} />);
    await user.type(screen.getByPlaceholderText('your@email.com'), 'replay@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /send my privacy check/i }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toMatchObject({ riskScore: EXPECTED.score, scoreVersion: SCORE_VERSION });

    // now the Worker, with the unapplied migration flag ON, against a stubbed store
    const stored: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.includes('mpt_score_baselines')) {
        if (init?.method === 'POST') { const b = JSON.parse(String(init.body)); stored.push(b); return new Response(JSON.stringify([{ ...b, created_at: '2026-10-26T00:00:00Z' }]), { status: 201 }); }
        return new Response('[]', { status: 200 });
      }
      return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
    }));
    const env = { NOTION_TOKEN: 'n', LEADS_DB_ID: 'abc-def', SUPABASE_SERVICE_ROLE_KEY: 'k', HUBSPOT_TOKEN: 'h', RESEND_API_KEY: 'r', SLACK_BOT_TOKEN: 's', BASELINE_SCORE_VERSION_COLUMN: 'true' };
    const res = await worker.fetch(new Request('https://x/webhook/leads', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify(posts[0]) }), env, { waitUntil: () => {} });
    const body = await res.json() as { baseline?: Record<string, unknown> };
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ overall_score: EXPECTED.score, score_version: SCORE_VERSION, category_scores: { device: 100, fingerprint: 100, storage: 0, security: 0 } });
    expect(body.baseline).toMatchObject({ overall_score: EXPECTED.score, score_version: SCORE_VERSION, is_first: true });
  });

  it('saved scan -> report JSON (the report email attachment): same score, band, coverage and version', () => {
    const items = toPayload(SCAN);   // exactly what the site sends to save the scan, statuses stamped at capture
    const web = normaliseHexagons(WEB_HEXAGONS, items);
    const report = buildReportJson({ scanId: 'replay', webScan: { id: 'w', created_at: '2026-10-26T00:00:00Z' }, web, emailHexes: [], score: null });
    const ex = report.web_scan.exposure;
    expect(ex).toMatchObject({ score_version: SCORE_VERSION, score: EXPECTED.score, band: EXPECTED.band, provisional: false });
    expect(ex.coverage).toEqual({ checked: EXPECTED.checked, total: 54, percent: EXPECTED.coverage });
    expect(report.web_scan.summary).toMatchObject({ found: EXPECTED.found, clear: EXPECTED.clear });
    // the page and the saved scan agree because both use the same status rules
    const page = exposureForPage(SCAN, true);
    expect({ score: ex.score, band: ex.band, coverage: ex.coverage, categories: ex.categories }).toEqual({ score: page.score, band: page.band, coverage: page.coverage, categories: page.categories });
  });

  it('a scan with nothing checked shows no score anywhere and never "Low"', () => {
    const empty = [hx('font-detection', '0 fonts'), hx('google-services', 'Signed in')];
    const r = exposureForPage(empty, true);
    expect(r.score).toBeNull();
    const { container } = render(<FinalSummaryPanel hexagons={empty} confirmedCount={2} />);
    expect(container.textContent).toContain('Not enough checked to score');
    expect(container.textContent).not.toMatch(/Low exposure/);
    const report = buildReportJson({ scanId: 'e', webScan: { id: 'w' }, web: normaliseHexagons(WEB_HEXAGONS, toPayload(empty)), emailHexes: [], score: null });
    expect(report.web_scan.exposure.score).toBeNull();
    expect(report.web_scan.exposure.band).toBeNull();
  });

  it('different evidence snapshots are provisional and may differ; the same snapshot never does', () => {
    const early = exposureForPage(SCAN.slice(0, 5), false);
    const final = exposureForPage(SCAN, true);
    expect(early.provisional).toBe(true);
    expect(final.provisional).toBe(false);
    expect(exposureForPage(SCAN, true)).toEqual(exposureForPage([...SCAN].reverse(), true));
  });
});
