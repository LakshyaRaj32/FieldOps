import type {
  ConnectivitySnapshot,
  ConnectivityStatus,
} from '../../services/network/connectivity';
import reducer, {
  connectivityChanged,
  type ConnectivityState,
} from './connectivitySlice';

const snapshot = (
  status: ConnectivityStatus,
  connectionType = 'wifi',
): ConnectivitySnapshot => ({
  status,
  connectionType,
  isInternetReachable:
    status === 'online' ? true : status === 'offline' ? false : null,
});

/** Applies a sequence of snapshots, each received at the given time. */
function applyAll(
  events: readonly [ConnectivitySnapshot, number][],
  initial: ConnectivityState = reducer(undefined, { type: 'init' }),
): ConnectivityState {
  return events.reduce((state, [event, receivedAt]) => {
    const action = { ...connectivityChanged(event), meta: { receivedAt } };
    return reducer(state, action);
  }, initial);
}

describe('connectivitySlice', () => {
  it('starts unknown', () => {
    expect(reducer(undefined, { type: 'init' }).status).toBe('unknown');
  });

  it('records when the status changes', () => {
    const state = applyAll([[snapshot('online'), 1000]]);
    expect(state.status).toBe('online');
    expect(state.lastChangedAt).toBe(1000);
  });

  it('does not treat the same status as a change', () => {
    const state = applyAll([
      [snapshot('online', 'wifi'), 1000],
      [snapshot('online', 'cellular'), 2000],
    ]);
    expect(state.lastChangedAt).toBe(1000);
    expect(state.connectionType).toBe('cellular');
  });

  it('returns the same state object when nothing changed (no re-render)', () => {
    const state = applyAll([[snapshot('online'), 1000]]);
    const next = reducer(state, {
      ...connectivityChanged(snapshot('online')),
      meta: { receivedAt: 5000 },
    });
    expect(next).toBe(state);
  });

  it('tracks recovery from offline through reconnecting to back online', () => {
    const offline = applyAll([
      [snapshot('online'), 1000],
      [snapshot('offline'), 2000],
    ]);
    expect(offline.recoveringFromOffline).toBe(true);

    const reconnecting = applyAll([[snapshot('checking'), 3000]], offline);
    expect(reconnecting.recoveringFromOffline).toBe(true);
    expect(reconnecting.restoredAt).toBeNull();

    const restored = applyAll([[snapshot('online'), 4000]], reconnecting);
    expect(restored.recoveringFromOffline).toBe(false);
    expect(restored.restoredAt).toBe(4000);
  });

  it('does not report a recovery when the app starts online', () => {
    const state = applyAll([
      [snapshot('checking'), 1000],
      [snapshot('online'), 2000],
    ]);
    expect(state.restoredAt).toBeNull();
  });

  it('timestamps actions when they are created', () => {
    jest.spyOn(Date, 'now').mockReturnValue(42);
    expect(connectivityChanged(snapshot('online')).meta.receivedAt).toBe(42);
    jest.restoreAllMocks();
  });
});
