import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RecheckPanel from './RecheckPanel';
import { setChoice } from '@/lib/cookieConsent';
import { RECHECK_KEY } from '@/lib/recheck/webrtcRecheck';
import { detectWebRTCLeak, WEBRTC_DETECTOR_VERSION } from '@/lib/fingerprintDetection';

// Synthetic visitor in jsdom. The browser's real localStorage is the store, read back directly; RTCPeerConnection is a fake that gathers
// scripted candidates (there is no network, no real address and no backend). Not a live run.
type Script = { candidates: string[]; end: boolean };
const fakeRTC = (script: Script) => class {
  onicecandidate: ((e: { candidate: { candidate: string } | null }) => void) | null = null;
  createDataChannel() { return {}; }
  async createOffer() { return {}; }
  async setLocalDescription() {
    setTimeout(() => {
      for (const c of script.candidates) this.onicecandidate?.({ candidate: { candidate: c } });
      if (script.end) this.onicecandidate?.({ candidate: null });
    }, 0);
  }
  close() {}
};
const PUBLIC = 'candidate:1 1 udp 1 203.0.113.7 5000 typ srflx';
const MDNS = 'candidate:2 1 udp 1 3f2a-uuid.local 5000 typ host';
const obsFound = { state: 'found', detectorVersion: WEBRTC_DETECTOR_VERSION };
const saved = () => JSON.parse(localStorage.getItem(RECHECK_KEY) ?? 'null');

beforeEach(() => { localStorage.clear(); setChoice(true); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('detectWebRTCLeak states (fake RTCPeerConnection)', () => {
  it('found / none_found / blocked / unsupported', async () => {
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [PUBLIC], end: true }));
    expect((await detectWebRTCLeak()).state).toBe('found');
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [MDNS], end: true }));
    const none = await detectWebRTCLeak();
    expect(none.state).toBe('none_found');
    expect(none.detectorVersion).toBe(WEBRTC_DETECTOR_VERSION);
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [], end: true }));
    expect((await detectWebRTCLeak()).state).toBe('blocked');
    vi.stubGlobal('RTCPeerConnection', undefined);
    expect((await detectWebRTCLeak()).state).toBe('unsupported');
  });
  it('timed_out when gathering never finishes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [MDNS], end: false }));
    const p = detectWebRTCLeak();
    await vi.advanceTimersByTimeAsync(3500);
    expect((await p).state).toBe('timed_out');
  });
});

describe('RecheckPanel journey', () => {
  it('renders nothing before an explanation is shown for a found reading', () => {
    const { container } = render(<RecheckPanel observation={obsFound} explained={false} told={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('observation -> explanation -> own word -> comparable re-check = observed improvement, scoped honestly', async () => {
    const { rerender } = render(<RecheckPanel observation={obsFound} explained told={false} />);
    expect(saved().baseline.state).toBe('found');
    expect(screen.getByTestId('recheck-selfreport')).toHaveTextContent(/haven't said/);
    expect(screen.queryByTestId('recheck-run')).toBeNull();
    rerender(<RecheckPanel observation={obsFound} explained={false} told />);
    await waitFor(() => expect(saved().selfReport.at).toBeTruthy());
    expect(screen.getByTestId('recheck-selfreport')).toHaveTextContent(/your word; we haven't confirmed/);
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [MDNS], end: true }));
    fireEvent.click(screen.getByTestId('recheck-run'));
    await waitFor(() => expect(screen.getByTestId('recheck-outcome')).toHaveAttribute('data-outcome', 'improvement'));
    expect(screen.getByTestId('recheck-outcome').textContent).toMatch(/one reading/);
    expect(screen.getByTestId('recheck-outcome').textContent).not.toMatch(/safe|protected|score|%/i);
    expect(saved().baseline.state).toBe('found');          // original evidence is untouched
    expect(saved().rechecks[0].observation.state).toBe('none_found');
  });

  it.each([
    ['no change', { candidates: [PUBLIC], end: true }, 'no_change'],
    ['inconclusive (blocked)', { candidates: [], end: true }, 'inconclusive'],
  ])('%s', async (_n, script, outcome) => {
    render(<RecheckPanel observation={obsFound} explained told />);
    await waitFor(() => expect(saved().selfReport).toBeTruthy());
    vi.stubGlobal('RTCPeerConnection', fakeRTC(script as Script));
    fireEvent.click(screen.getByTestId('recheck-run'));
    await waitFor(() => expect(screen.getByTestId('recheck-outcome')).toHaveAttribute('data-outcome', outcome));
  });

  it('a throwing detector is shown as a re-check error, not as a result', async () => {
    render(<RecheckPanel observation={obsFound} explained told />);
    await waitFor(() => expect(saved().selfReport).toBeTruthy());
    vi.stubGlobal('RTCPeerConnection', class { constructor() { throw new Error('boom'); } });
    fireEvent.click(screen.getByTestId('recheck-run'));
    await waitFor(() => expect(screen.getByTestId('recheck-outcome')).toHaveAttribute('data-outcome', 'error'));
  });

  it('a reload records nothing by itself; the visitor presses Check again and it is compared with the saved first reading', async () => {
    const first = render(<RecheckPanel observation={obsFound} explained told />);
    await waitFor(() => expect(saved().selfReport).toBeTruthy());
    first.unmount();
    // next visit: the page's own fresh reading must NOT become a re-check without a press
    render(<RecheckPanel observation={{ state: 'none_found', detectorVersion: WEBRTC_DETECTOR_VERSION }} explained={false} told={false} />);
    expect(screen.queryByTestId('recheck-outcome')).toBeNull();
    expect(saved().rechecks).toHaveLength(0);
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [MDNS], end: true }));
    fireEvent.click(screen.getByTestId('recheck-run'));
    await waitFor(() => expect(screen.getByTestId('recheck-outcome')).toHaveAttribute('data-outcome', 'improvement'));
    expect(saved().rechecks).toHaveLength(1);
  });

  it('a closed prompt (explained, never told) stores no response and offers no re-check', async () => {
    const view = render(<RecheckPanel observation={obsFound} explained told={false} />);
    await waitFor(() => expect(saved().baseline.state).toBe('found'));
    expect(saved().selfReport).toBeUndefined();
    expect(screen.queryByTestId('recheck-run')).toBeNull();
    view.unmount();
    expect(saved().selfReport).toBeUndefined();
  });

  it('missing consent: nothing is stored and the panel says it cannot compare', () => {
    setChoice(false);
    render(<RecheckPanel observation={obsFound} explained told />);
    expect(localStorage.getItem(RECHECK_KEY)).toBeNull();
    expect(screen.getByTestId('recheck-no-consent')).toBeInTheDocument();
    expect(screen.queryByTestId('recheck-run')).toBeNull();
  });

  it('withdrawal removes the saved journey and the baseline line', async () => {
    render(<RecheckPanel observation={obsFound} explained told />);
    await waitFor(() => expect(saved()).not.toBeNull());
    act(() => setChoice(false));
    await waitFor(() => expect(localStorage.getItem(RECHECK_KEY)).toBeNull());
    expect(screen.queryByTestId('recheck-baseline')).toBeNull();
  });

  it('"Forget this check" deletes it, and sends nothing over the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<RecheckPanel observation={obsFound} explained told />);
    await waitFor(() => expect(saved()).not.toBeNull());
    vi.stubGlobal('RTCPeerConnection', fakeRTC({ candidates: [MDNS], end: true }));
    fireEvent.click(screen.getByTestId('recheck-run'));
    await waitFor(() => expect(screen.getByTestId('recheck-outcome')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('recheck-forget'));
    expect(localStorage.getItem(RECHECK_KEY)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
