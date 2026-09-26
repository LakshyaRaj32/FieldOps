import { Role } from '@fieldops/types';

import { createAppStore } from '../index';
import {
  developmentSessionStarted,
  selectSessionUser,
  signOut,
} from './sessionSlice';

describe('session state', () => {
  it('starts signed out', () => {
    const store = createAppStore();
    expect(store.getState().session).toEqual({ status: 'signedOut' });
  });

  it.each([Role.WORKER, Role.MANAGER, Role.ADMIN])(
    'starts a development session as %s',
    role => {
      const store = createAppStore();
      store.dispatch(developmentSessionStarted(role));

      const { session } = store.getState();
      expect(session.status).toBe('signedIn');
      expect(selectSessionUser(store.getState())?.role).toBe(role);
      expect(session.status === 'signedIn' && session.source).toBe(
        'development',
      );
    },
  );

  it('signs out and clears cached server state', () => {
    const store = createAppStore();
    store.dispatch(developmentSessionStarted(Role.MANAGER));
    const apiStateBefore = store.getState().api;

    store.dispatch(signOut());

    expect(store.getState().session).toEqual({ status: 'signedOut' });
    // resetApiState replaces the RTK Query slice with a fresh initial state.
    expect(store.getState().api).not.toBe(apiStateBefore);
    expect(store.getState().api.queries).toEqual({});
  });
});
