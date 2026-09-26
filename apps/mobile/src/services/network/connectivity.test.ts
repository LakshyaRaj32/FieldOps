import {
  deriveConnectivityStatus,
  toConnectivitySnapshot,
} from './connectivity';

describe('deriveConnectivityStatus', () => {
  it.each([
    // [isConnected, isInternetReachable, expected]
    [null, null, 'unknown'],
    [false, null, 'offline'],
    [false, true, 'offline'],
    [true, null, 'checking'],
    [true, undefined, 'checking'],
    [true, true, 'online'],
    // Connected to Wi-Fi without internet (captive portal, dead router) is offline.
    [true, false, 'offline'],
  ] as const)(
    'isConnected=%s, isInternetReachable=%s -> %s',
    (isConnected, isInternetReachable, expected) => {
      expect(
        deriveConnectivityStatus({ isConnected, isInternetReachable }),
      ).toBe(expected);
    },
  );
});

describe('toConnectivitySnapshot', () => {
  it('normalizes an undefined reachability to null', () => {
    expect(
      toConnectivitySnapshot({
        type: 'cellular',
        isConnected: true,
        isInternetReachable: undefined,
      }),
    ).toEqual({
      status: 'checking',
      connectionType: 'cellular',
      isInternetReachable: null,
    });
  });
});
