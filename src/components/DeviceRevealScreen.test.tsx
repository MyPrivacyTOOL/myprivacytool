import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeviceRevealScreen from './DeviceRevealScreen';
import { identifyDevice } from '@/lib/deviceIdentity';

const mac = identifyDevice({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  platform: 'MacIntel', maxTouchPoints: 0, screenWidth: 1440, screenHeight: 900, pixelRatio: 2,
});
const unknown = identifyDevice({ userAgent: 'curl/8.0', platform: '', maxTouchPoints: 0, screenWidth: 1, screenHeight: 1, pixelRatio: 1 });

beforeEach(() => {
  // reduced motion: lock on immediately, no timers
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  document.body.style.overflow = '';
});

describe('DeviceRevealScreen', () => {
  it('is a full-screen modal dialog that locks page scroll and restores it on close', () => {
    const { unmount } = render(<DeviceRevealScreen identity={mac} rotationAngle={0} onDone={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('fixed inset-0');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('shows the locked device and continues without a spotlight for a certain device', () => {
    const onDone = vi.fn();
    render(<DeviceRevealScreen identity={mac} rotationAngle={0} onDone={onDone} />);
    expect(screen.getByText('Mac')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /see everything we found/i }));
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('takes the honest unknown path and asks to jump to the spotlight', () => {
    const onDone = vi.fn();
    render(<DeviceRevealScreen identity={unknown} rotationAngle={0} onDone={onDone} />);
    expect(screen.getByText(/can’t be certain/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /see what we can see/i }));
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('shows no content or button until the identity is known', () => {
    render(<DeviceRevealScreen identity={null} rotationAngle={0} onDone={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('closes on Escape', () => {
    const onDone = vi.fn();
    render(<DeviceRevealScreen identity={mac} rotationAngle={0} onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledWith(false);
  });
});
