import { useState } from 'react';
import {
  compareDeviceToGuess,
  deviceCheckMessage,
  DEVICE_CHECK_ERROR_TEXT,
  requestDevicePosition,
  type DeviceCheckError,
  type DeviceCheckResult,
  type GuessCheckSpec,
  type LatLon,
} from '@/lib/guessCheck';

interface GuessCheckCardProps {
  label: string;
  value: string;
  spec: GuessCheckSpec;
  /** Where our guess puts the visitor (from the IP lookup), for the device comparison. */
  guess?: LatLon;
  answered: 'yes' | 'no' | 'device_agrees' | 'device_far' | null;
  onAnswer: (a: 'yes' | 'no') => void;
  onDevice: (r: DeviceCheckResult) => void;
  /** Injected in tests; the browser's geolocation by default. */
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
}

// A guess is only worth showing if it can be made true. One tap settles it as the visitor's word; the device check settles it for real.
// "Not sure" is no answer, never a "no". The device position is compared here in the browser and is not sent or stored.
export default function GuessCheckCard({ label, value, spec, guess, answered, onAnswer, onDevice, geolocation }: GuessCheckCardProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceCheckResult | null>(null);
  const [error, setError] = useState<DeviceCheckError | null>(null);

  const checkDevice = async () => {
    setBusy(true);
    setError(null);
    try {
      const pos = await requestDevicePosition(geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined));
      if (!guess) throw 'unavailable';
      const r = compareDeviceToGuess(pos, guess);
      setResult(r);
      onDevice(r);
    } catch (e) {
      setError((e === 'denied' || e === 'timeout' ? e : 'unavailable') as DeviceCheckError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="max-w-xl mx-auto mb-4 rounded-2xl border-2 border-[hsl(var(--tile-purple))] bg-surface p-4 sm:p-5 shadow-card"
      aria-labelledby="guess-check-title"
      data-testid="guess-check"
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Is our guess right? · {label}</p>
      <h3 id="guess-check-title" className="text-lg font-semibold text-foreground">{spec.question(value)}</h3>
      {answered === null ? (
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            onClick={() => onAnswer('yes')}
            className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            data-testid="guess-yes"
          >
            {spec.yes}
          </button>
          <button
            type="button"
            onClick={() => onAnswer('no')}
            className="rounded-lg border border-surface-border px-4 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            data-testid="guess-no"
          >
            {spec.no}
          </button>
        </div>
      ) : (
        <p className="text-sm text-foreground mt-2" data-testid="guess-answer">
          {answered === 'yes' && 'You said yes. That is your word, not our proof.'}
          {answered === 'no' && 'You said no. Our guess was wrong.'}
          {answered === 'device_agrees' && 'Your device agrees with our guess.'}
          {answered === 'device_far' && 'Your device says our guess was wrong.'}
        </p>
      )}

      {spec.deviceCheck && guess && !result && answered !== 'device_agrees' && answered !== 'device_far' && (
        <div className="mt-3 border-t border-surface-border pt-3">
          <button
            type="button"
            onClick={checkDevice}
            disabled={busy}
            className="rounded-lg border border-dashed border-[hsl(var(--tile-purple))] px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            data-testid="guess-device"
          >
            {busy ? 'Waiting for your device…' : 'Check with my device'}
          </button>
          <p className="text-xs text-muted-foreground mt-2" data-testid="guess-privacy">
            Your browser asks you first. We compare your device's position with our guess here in your browser. Nothing is sent or stored.
          </p>
        </div>
      )}
      {result && <p className="text-sm text-foreground mt-3" data-testid="guess-device-result">{deviceCheckMessage(result)}</p>}
      {error && <p className="text-sm text-muted-foreground mt-3" role="status" data-testid="guess-device-error">{DEVICE_CHECK_ERROR_TEXT[error]}</p>}
    </section>
  );
}
