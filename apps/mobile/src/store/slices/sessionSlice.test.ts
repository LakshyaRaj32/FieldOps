import { Role, type UserProfile } from '@fieldops/types';

import { sessionEnded } from '../../services/auth/sessionEvents';
import { createAppStore } from '../index';
import {
  selectSessionUser,
  selectSignedOutReason,
  signedIn,
  signedOut,
  userUpdated,
} from './sessionSlice';

const user: UserProfile = {
  id: 'user-1',
  email: 'asha@example.com',
  firstName: 'Asha',
  lastName: 'Verma',
  role: Role.WORKER,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('session state', () => {
  it('starts restoring, so no screen renders before the stored session is read', () => {
    const store = createAppStore();
    expect(store.getState().session).toEqual({ status: 'restoring' });
  });

  it('signs in with the user profile only', () => {
    const store = createAppStore();
    store.dispatch(signedIn(user));

    expect(store.getState().session).toEqual({ status: 'signedIn', user });
    expect(selectSessionUser(store.getState())).toEqual(user);
  });

  it('updates the profile of a signed-in user and ignores updates otherwise', () => {
    const store = createAppStore();
    store.dispatch(userUpdated({ ...user, role: Role.MANAGER }));
    expect(store.getState().session.status).toBe('restoring');

    store.dispatch(signedIn(user));
    store.dispatch(userUpdated({ ...user, role: Role.MANAGER }));
    expect(selectSessionUser(store.getState())?.role).toBe(Role.MANAGER);
  });

  it('records why the user was signed out', () => {
    const store = createAppStore();
    store.dispatch(signedIn(user));

    store.dispatch(sessionEnded());
    expect(store.getState().session).toEqual({
      status: 'signedOut',
      reason: 'sessionEnded',
    });
    expect(selectSignedOutReason(store.getState())).toBe('sessionEnded');

    store.dispatch(signedOut(undefined));
    expect(store.getState().session).toEqual({ status: 'signedOut' });
  });
});
