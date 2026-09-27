import {
  describeLocationFailure,
  failureFromNativeCode,
  toDeviceLocation,
} from './locationResult';

describe('failureFromNativeCode', () => {
  it.each([
    ['PERMISSION_DENIED', 'permission_denied'],
    ['SERVICES_DISABLED', 'services_disabled'],
    ['TIMEOUT', 'timeout'],
    ['UNAVAILABLE', 'unavailable'],
    [undefined, 'unavailable'],
    ['E_WEIRD', 'unavailable'],
  ])('%s → %s', (code, kind) => {
    expect(failureFromNativeCode(code)).toEqual({ kind });
  });
});

describe('toDeviceLocation', () => {
  const fix = {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracyMeters: 14.5,
    timestamp: Date.parse('2026-09-28T05:01:00.000Z'),
  };

  it('converts a native fix to the API shape', () => {
    expect(toDeviceLocation(fix)).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 14.5,
      capturedAt: '2026-09-28T05:01:00.000Z',
    });
  });

  it('refuses invalid coordinates or accuracy', () => {
    expect(toDeviceLocation({ ...fix, latitude: 95 })).toBeNull();
    expect(toDeviceLocation({ ...fix, longitude: Number.NaN })).toBeNull();
    expect(toDeviceLocation({ ...fix, accuracyMeters: -3 })).toBeNull();
  });

  it('caps absurd accuracy values to what the API accepts', () => {
    expect(
      toDeviceLocation({ ...fix, accuracyMeters: 5_000_000 })?.accuracyMeters,
    ).toBe(100_000);
  });
});

describe('describeLocationFailure', () => {
  it('offers the action that can fix each case', () => {
    expect(describeLocationFailure('permission_denied').action).toBe('request');
    expect(describeLocationFailure('permission_blocked').action).toBe(
      'settings',
    );
    expect(describeLocationFailure('services_disabled').action).toBe(
      'location_settings',
    );
    expect(describeLocationFailure('timeout').action).toBe('retry');
  });
});
