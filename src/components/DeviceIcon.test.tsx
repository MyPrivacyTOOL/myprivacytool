import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeviceIcon from './DeviceIcon';

describe('DeviceIcon', () => {
  it('turns the portrait drawing with the screen angle so rotation is a flip, not a swap', () => {
    const { rerender } = render(<DeviceIcon deviceType="Smartphone" rotationAngle={0} />);
    expect(screen.getByTestId('device-flip').style.transform).toBe('rotateZ(0deg)');
    expect(screen.getByText('Portrait')).toBeTruthy();

    rerender(<DeviceIcon deviceType="Smartphone" rotationAngle={90} />);
    expect(screen.getByTestId('device-flip').style.transform).toBe('rotateZ(90deg)');
    expect(screen.getByText('Landscape')).toBeTruthy();
  });

  it('does not switch drawings from tilt alone (tilt must not double-rotate the flip)', () => {
    render(<DeviceIcon deviceType="Smartphone" rotationAngle={90} beta={10} gamma={80} />);
    expect(screen.getByText('Landscape')).toBeTruthy();
    expect(screen.getByTestId('device-flip').style.transform).toBe('rotateZ(90deg)');
  });

  it('shows the connect button only when asked, and calls the handler on tap', () => {
    const onEnable = vi.fn();
    const { rerender } = render(<DeviceIcon deviceType="Smartphone" rotationAngle={0} />);
    expect(screen.queryByText(/connect your phone/i)).toBeNull();

    rerender(<DeviceIcon deviceType="Smartphone" rotationAngle={0} motionPrompt onEnableMotion={onEnable} />);
    fireEvent.click(screen.getByText(/connect your phone/i));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });
});
