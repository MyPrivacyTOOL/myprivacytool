import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import DeviceReveal from '@/components/DeviceReveal';
import UnknownDeviceHero from '@/components/UnknownDeviceHero';
import type { DeviceIdentity } from '@/lib/deviceIdentity';

interface DeviceRevealScreenProps {
  /** null while the signals are still being read: the screen is up, the content follows. */
  identity: DeviceIdentity | null;
  rotationAngle: number;
  beta?: number | null;
  gamma?: number | null;
  motionPrompt?: boolean;
  onEnableMotion?: () => void;
  /** Close the screen. `jumpToSpotlight` is true on the unknown path, where we then point at a hexagon. */
  onDone: (jumpToSpotlight: boolean) => void;
}

/**
 * The opening moment: the whole screen is the reveal. A device we can be
 * certain about spins and locks on; anything else says so honestly. One button
 * (or Escape) hands over to the page.
 */
export default function DeviceRevealScreen({
  identity,
  rotationAngle,
  beta,
  gamma,
  motionPrompt,
  onEnableMotion,
  onDone,
}: DeviceRevealScreenProps) {
  const unknown = !!identity && !identity.certain;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Full screen means the page behind does not scroll; Escape closes.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doneRef.current(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (identity) buttonRef.current?.focus({ preventScroll: true });
  }, [identity]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your device"
      data-testid="device-reveal-screen"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-background px-6 pb-40 pt-10 text-center"
    >
      {identity?.certain && (
        <DeviceReveal
          identity={identity}
          rotationAngle={rotationAngle}
          beta={beta}
          gamma={gamma}
          motionPrompt={motionPrompt}
          onEnableMotion={onEnableMotion}
          fullscreen
        />
      )}
      {unknown && <UnknownDeviceHero spotlightId="browser" spotlightLabel="Browser" canJump={false} fullscreen />}

      {identity && (
        <Button ref={buttonRef} size="lg" onClick={() => onDone(unknown)}>
          {unknown ? 'See what we can see' : 'See everything we found'}
        </Button>
      )}
    </div>
  );
}
