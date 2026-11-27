import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DeviceReveal from './DeviceReveal';
import { identifyDevice } from '@/lib/deviceIdentity';

const mac = identifyDevice({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  platform: 'MacIntel', maxTouchPoints: 0, screenWidth: 1440, screenHeight: 900, pixelRatio: 2,
});
const iphone = identifyDevice({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone', maxTouchPoints: 5, screenWidth: 393, screenHeight: 852, pixelRatio: 3,
});

function mockReducedMotion() {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
}

describe('DeviceReveal motion prompt', () => {
  it('offers to connect sensors on an iPhone', () => {
    mockReducedMotion();
    if (!iphone.certain) throw new Error('fixture');
    render(<DeviceReveal identity={iphone} rotationAngle={0} motionPrompt onEnableMotion={() => {}} />);
    expect(screen.getByText(/connect your phone/i)).toBeTruthy();
  });

  it('never offers it on a Mac, even if the browser exposes requestPermission', () => {
    mockReducedMotion();
    if (!mac.certain) throw new Error('fixture');
    render(<DeviceReveal identity={mac} rotationAngle={0} motionPrompt onEnableMotion={() => {}} />);
    expect(screen.queryByText(/connect your phone/i)).toBeNull();
  });
});
