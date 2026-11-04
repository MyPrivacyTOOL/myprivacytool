import { useEffect, useMemo, useState } from 'react';
import DeviceIcon from '@/components/DeviceIcon';
import { CAROUSEL_DEVICES, type DeviceCategory, type DeviceIdentity } from '@/lib/deviceIdentity';

/** Which illustration represents each category. Computers share a neutral screen. */
const ILLUSTRATION: Record<DeviceCategory, string> = {
  iphone: 'Smartphone',
  'android-phone': 'Smartphone',
  ipad: 'Tablet',
  'android-tablet': 'Tablet',
  mac: 'Desktop',
  windows: 'Desktop',
  linux: 'Desktop',
  chromeos: 'Laptop',
};

type CertainIdentity = Extract<DeviceIdentity, { certain: true }>;

interface DeviceRevealProps {
  identity: CertainIdentity;
  rotationAngle: number;
  beta?: number | null;
  gamma?: number | null;
}

const START_DELAY_MS = 55;
const SLOW_DOWN = 1.06;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Spins through the devices we can recognise, decelerates, and locks onto the
 * visitor's. Only rendered for a certain identity — unknown never reaches here.
 */
export default function DeviceReveal({ identity, rotationAngle, beta, gamma }: DeviceRevealProps) {
  const targetIndex = useMemo(
    () => Math.max(0, CAROUSEL_DEVICES.findIndex((d) => d.category === identity.category)),
    [identity.category],
  );
  const [index, setIndex] = useState(targetIndex);
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setIndex(targetIndex);
      setLocked(true);
      return;
    }

    // One lap plus the distance to the target, slowing down as it goes.
    const steps = CAROUSEL_DEVICES.length + targetIndex;
    let step = 0;
    let delay = START_DELAY_MS;
    let timer: ReturnType<typeof setTimeout>;

    setIndex(0);
    setLocked(false);

    const tick = () => {
      step += 1;
      setIndex(step % CAROUSEL_DEVICES.length);
      if (step >= steps) {
        setLocked(true);
        return;
      }
      delay *= SLOW_DOWN;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [targetIndex]);

  const shown = locked ? identity : CAROUSEL_DEVICES[index];
  const category = locked ? identity.category : CAROUSEL_DEVICES[index].category;

  return (
    <DeviceIcon
      deviceType={ILLUSTRATION[category]}
      label={shown.label}
      evidence={locked ? identity.evidence : null}
      scanning={!locked}
      rotationAngle={rotationAngle}
      beta={beta}
      gamma={gamma}
    />
  );
}
