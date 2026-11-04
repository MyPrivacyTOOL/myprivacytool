import { describe, it, expect } from 'vitest';
import { identifyDevice, type DeviceSignals } from './deviceIdentity';

const base: DeviceSignals = {
  userAgent: '',
  platform: '',
  maxTouchPoints: 0,
  screenWidth: 1440,
  screenHeight: 900,
  pixelRatio: 2,
  uaData: null,
};

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
};

describe('identifyDevice', () => {
  it('identifies an iPhone with touch hardware', () => {
    const r = identifyDevice({ ...base, userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 });
    expect(r).toMatchObject({ certain: true, category: 'iphone' });
  });

  it('tells an iPad in desktop mode apart from a Mac by touch points', () => {
    const ipad = identifyDevice({ ...base, userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 });
    const mac = identifyDevice({ ...base, userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 0 });
    expect(ipad).toMatchObject({ certain: true, category: 'ipad' });
    expect(mac).toMatchObject({ certain: true, category: 'mac' });
  });

  it('names an Android phone exactly only when the browser reports the model', () => {
    const named = identifyDevice({
      ...base, userAgent: UA.androidPhone, platform: 'Linux armv8l', maxTouchPoints: 5,
      uaData: { platform: 'Android', mobile: true, model: 'Pixel 8' },
    });
    const generic = identifyDevice({ ...base, userAgent: UA.androidPhone, platform: 'Linux armv8l', maxTouchPoints: 5 });
    expect(named).toMatchObject({ certain: true, category: 'android-phone', label: 'Pixel 8', model: 'Pixel 8' });
    expect(generic).toMatchObject({ certain: true, category: 'android-phone', label: 'Android phone' });
  });

  it('separates Android tablets from phones', () => {
    const r = identifyDevice({ ...base, userAgent: UA.androidTablet, platform: 'Linux armv8l', maxTouchPoints: 5 });
    expect(r).toMatchObject({ certain: true, category: 'android-tablet' });
  });

  it('identifies desktop operating systems', () => {
    expect(identifyDevice({ ...base, userAgent: UA.windows, platform: 'Win32' })).toMatchObject({ category: 'windows' });
    expect(identifyDevice({ ...base, userAgent: UA.mac, platform: 'MacIntel' })).toMatchObject({ category: 'mac' });
    expect(identifyDevice({ ...base, userAgent: UA.linux, platform: 'Linux x86_64' })).toMatchObject({ category: 'linux' });
  });

  it('is unknown when a phone user agent has no touch hardware (emulation/spoofing)', () => {
    const r = identifyDevice({ ...base, userAgent: UA.iphone, platform: 'MacIntel', maxTouchPoints: 0 });
    expect(r.certain).toBe(false);
  });

  it('is unknown when client hints contradict the user agent', () => {
    const r = identifyDevice({
      ...base, userAgent: UA.windows, platform: 'Win32',
      uaData: { platform: 'Android', mobile: true },
    });
    expect(r.certain).toBe(false);
  });

  it('is unknown for unrecognised signals', () => {
    expect(identifyDevice({ ...base, userAgent: 'curl/8.0', platform: '' }).certain).toBe(false);
    expect(identifyDevice({ ...base, userAgent: '', platform: '' }).certain).toBe(false);
  });
});
