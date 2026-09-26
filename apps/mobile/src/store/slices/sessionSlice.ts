import {
  createSlice,
  type Dispatch,
  type PayloadAction,
} from '@reduxjs/toolkit';
import { Role } from '@fieldops/types';

import { baseApi } from '../../services/api/baseApi';

export interface SessionUser {
  readonly displayName: string;
  readonly role: Role;
}

/**
 * Application state: who is using the app.
 *
 * Version 1 has no real authentication. The only way to sign in is the development entry
 * on the login screen (`source: 'development'`), available only in development builds.
 * Version 2 replaces it with real sessions; tokens will live in secure storage, never here.
 */
export type SessionState =
  | { readonly status: 'signedOut' }
  | {
      readonly status: 'signedIn';
      readonly user: SessionUser;
      readonly source: 'development';
    };

const initialState = { status: 'signedOut' } as SessionState;

const DEVELOPMENT_NAMES: Readonly<Record<Role, string>> = {
  [Role.WORKER]: 'Dev Worker',
  [Role.MANAGER]: 'Dev Manager',
  [Role.ADMIN]: 'Dev Admin',
};

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    developmentSessionStarted: (
      _state,
      action: PayloadAction<Role>,
    ): SessionState => ({
      status: 'signedIn',
      user: {
        displayName: DEVELOPMENT_NAMES[action.payload],
        role: action.payload,
      },
      source: 'development',
    }),
    signedOut: (): SessionState => ({ status: 'signedOut' }),
  },
  selectors: {
    selectSession: state => state,
    selectSessionStatus: state => state.status,
    selectSessionUser: state =>
      state.status === 'signedIn' ? state.user : null,
  },
});

export const { developmentSessionStarted } = sessionSlice.actions;
export const { selectSession, selectSessionStatus, selectSessionUser } =
  sessionSlice.selectors;

/** Signs out and clears cached server state so the next user never sees the previous user's data. */
export const signOut = () => (dispatch: Dispatch) => {
  dispatch(sessionSlice.actions.signedOut());
  dispatch(baseApi.util.resetApiState());
};

export default sessionSlice.reducer;
