import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import FinalSummaryPanel from './FinalSummaryPanel';
import { toTile } from '@/lib/hexagonTile';
import type { HexagonData } from '@/lib/deviceDetection';

vi.mock('@/components/EmailCaptureModal', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const hexagons: HexagonData[] = [
  { id: 'device', label: 'Device Type', value: 'Desktop', icon: '💻', confidence: 92, risk: 'r', confirmed: true, category: 'device' },
];
const tiles = new Map(hexagons.map((h) => [h.id, toTile(h)]));
const panel = (props: { level2Complete?: boolean } = {}) => render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={1} tiles={tiles} {...props} />);

function stubDownloads() {
  const clicks: string[] = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
  return clicks;
}

describe('signed report button', () => {
  it('is hidden by default, with the flag alone, and with Level 2 alone', () => {
    panel({ level2Complete: true });
    expect(screen.queryByTestId('download-signed-report')).toBeNull();
    cleanup();
    vi.stubEnv('VITE_SIGNED_REPORT', 'true');
    panel();
    expect(screen.queryByTestId('download-signed-report')).toBeNull();
  });

  it('shows with the flag and Level 2, and downloads the signed JSON', async () => {
    vi.stubEnv('VITE_SIGNED_REPORT', 'true');
    const clicks = stubDownloads();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: {}, signature: { value: 'v', public_key: 'k', signed_at: 't', issuer: 'MyPrivacyTOOL' } })));
    vi.stubGlobal('fetch', fetchMock);
    panel({ level2Complete: true });
    fireEvent.click(screen.getByTestId('download-signed-report'));
    await waitFor(() => expect(clicks.some((n) => n.endsWith('.signed.json'))).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/report-download');
    expect(JSON.parse(String(init.body)).report.hexagons[0].id).toBe('device');
  });

  it('says what to do when the server refuses, and downloads nothing', async () => {
    vi.stubEnv('VITE_SIGNED_REPORT', 'true');
    const clicks = stubDownloads();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"level2_required"}', { status: 403 })));
    panel({ level2Complete: true });
    fireEvent.click(screen.getByTestId('download-signed-report'));
    const msg = await screen.findByTestId('signed-report-message');
    expect(msg).toHaveTextContent(/Finish the confirmation step/);
    expect(msg.textContent).not.toMatch(/403|level2_required/);
    expect(clicks).toEqual([]);
  });
});

describe('signed PDF', () => {
  it('signs the exact PDF bytes and downloads the PDF with its signature file', async () => {
    vi.stubEnv('VITE_SIGNED_REPORT', 'true');
    const clicks = stubDownloads();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      return new Response(JSON.stringify(b.pdf_base64
        ? { signature: { sha256: 'h', value: 'v', public_key: 'k', signed_at: 't', issuer: 'MyPrivacyTOOL' } }
        : { report: b.report, signature: { value: 'v', public_key: 'k', signed_at: 't', issuer: 'MyPrivacyTOOL' } }));
    }));
    render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={1} level2Complete />);
    fireEvent.click(screen.getByTestId('download-signed-report'));
    await waitFor(() => expect(clicks.length).toBe(3), { timeout: 20000 });
    expect(clicks.map((n) => n.replace(/\d+/, 'N'))).toEqual(['digital-shadow-report-N.signed.json', 'digital-shadow-report-N.pdf', 'digital-shadow-report-N.pdf.sig.json']);
    expect(bodies).toHaveLength(2);
    expect(atob(String(bodies[1].pdf_base64)).startsWith('%PDF-')).toBe(true);
  }, 30000);

  it('a refused PDF signature downloads neither the PDF nor a signature', async () => {
    vi.stubEnv('VITE_SIGNED_REPORT', 'true');
    const clicks = stubDownloads();
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      return n++ === 0 ? new Response(JSON.stringify({ report: b.report, signature: { value: 'v', public_key: 'k', signed_at: 't', issuer: 'x' } })) : new Response('{}', { status: 503 });
    }));
    render(<FinalSummaryPanel hexagons={hexagons} confirmedCount={1} level2Complete />);
    fireEvent.click(screen.getByTestId('download-signed-report'));
    expect(await screen.findByTestId('signed-report-message', {}, { timeout: 20000 })).toHaveTextContent(/not available right now/);
    expect(clicks.filter((c) => c.includes('.pdf'))).toEqual([]);
  }, 30000);
});
