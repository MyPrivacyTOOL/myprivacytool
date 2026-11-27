import { describe, it, expect } from 'vitest';
import { identifyDevice, hedgeDeviceHexagon, labelAndroidModel, type DeviceSignals } from './deviceIdentity';
import type { HexagonData } from './deviceDetection';

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

  it('does not call an iPhone in desktop-site mode an iPad', () => {
    const desktopMode = { ...base, userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 };
    expect(identifyDevice({ ...desktopMode, screenWidth: 393, screenHeight: 852 })).toMatchObject({ certain: true, category: 'iphone' });
    expect(identifyDevice({ ...desktopMode, screenWidth: 820, screenHeight: 1180 })).toMatchObject({ certain: true, category: 'ipad' });
  });

  it('is unknown for a touch Apple device with an ambiguous screen size', () => {
    const r = identifyDevice({ ...base, userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5, screenWidth: 600, screenHeight: 900 });
    expect(r.certain).toBe(false);
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

describe('labelAndroidModel', () => {
  it('labels a Samsung model code with the code in brackets', () => {
    expect(labelAndroidModel('SM-S918B')).toBe('Samsung phone (SM-S918B)');
  });

  it('drops the dual-SIM /DS suffix but keeps the base code', () => {
    expect(labelAndroidModel('SM-S918B/DS')).toBe('Samsung phone (SM-S918B)');
  });

  it('leaves other vendors exactly as reported', () => {
    expect(labelAndroidModel('Pixel 8')).toBe('Pixel 8');
  });

  it('needs letters or digits after SM-, so a bare prefix stays as reported', () => {
    expect(labelAndroidModel('SM-')).toBe('SM-');
  });

  it('is case-sensitive, so a lowercase code stays as reported', () => {
    expect(labelAndroidModel('sm-s918b')).toBe('sm-s918b');
  });

  it('matches the whole string, so prefixed or padded codes stay as reported', () => {
    expect(labelAndroidModel('XSM-S918B')).toBe('XSM-S918B');
    expect(labelAndroidModel('SM-S918B extra')).toBe('SM-S918B extra');
  });

  it('returns a missing or non-string model unchanged instead of throwing', () => {
    expect(labelAndroidModel(undefined)).toBeUndefined();
    expect(labelAndroidModel(null)).toBeNull();
    expect(labelAndroidModel(42)).toBe(42);
  });

  it('feeds the reveal label while keeping the exact reported model', () => {
    const r = identifyDevice({
      ...base, userAgent: UA.androidPhone, platform: 'Linux armv8l', maxTouchPoints: 5,
      uaData: { platform: 'Android', mobile: true, model: 'SM-S918B/DS' },
    });
    expect(r).toMatchObject({ certain: true, category: 'android-phone', label: 'Samsung phone (SM-S918B)', model: 'SM-S918B/DS' });
  });
});

describe('hedgeDeviceHexagon', () => {
  const hex = (id: string): HexagonData => ({
    id, label: 'Device Type', value: 'Mobile (Android 14)', icon: '📱',
    confidence: 92, risk: '', confirmed: false, category: 'device',
  });
  const unknown = { certain: false as const, reason: 'x' };
  const certain = identifyDevice({
    ...base, userAgent: UA.mac, platform: 'MacIntel',
  });

  it('relabels the device hexagon as a low-confidence question when unknown', () => {
    const [device, other] = hedgeDeviceHexagon([hex('device'), hex('browser')], unknown);
    expect(device).toMatchObject({ label: 'Device Type (our guess)', value: 'Mobile (Android 14)?', confidence: 50 });
    expect(other).toMatchObject({ label: 'Device Type', confidence: 92 });
  });

  it('leaves hexagons untouched when certain or not yet identified', () => {
    const list = [hex('device')];
    expect(hedgeDeviceHexagon(list, certain)).toBe(list);
    expect(hedgeDeviceHexagon(list, null)).toBe(list);
  });

  it('is idempotent', () => {
    const once = hedgeDeviceHexagon([hex('device')], unknown);
    expect(hedgeDeviceHexagon(once, unknown)[0].value).toBe('Mobile (Android 14)?');
  });
});
