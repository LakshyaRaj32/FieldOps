import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserProfile } from '@fieldops/types';

import { sessionEnded } from '../../services/auth/sessionEvents';

export type SessionUser = UserProfile;

/** Why the user is signed out: shown on the sign-in screen. */
export type SignedOutReason = 'signedOut' | 'sessionEnded';

/**
 * Application state: who is using the app.
 *
 * - `restoring`: app start, while the stored session is read from secure storage
 * - `signedOut`: the sign-in screens are shown
 * - `signedIn`: the main app is shown, with the user's profile
 *
 * Tokens are never stored here; they live in the credential store (Android Keystore). The
 * thunks that move between these states are in features/auth/session.ts.
 */
export type SessionState =
  | { readonly status: 'restoring' }
  | { readonly status: 'signedOut'; readonly reason?: SignedOutReason }
  | { readonly status: 'signedIn'; readonly user: SessionUser };

const initialState = { status: 'restoring' } as SessionState;

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    signedIn: (_state, action: PayloadAction<SessionUser>): SessionState => ({
      status: 'signedIn',
      user: action.payload,
    }),
    /** The profile was refreshed from the server (name or role changed). */
    userUpdated: (state, action: PayloadAction<SessionUser>): SessionState =>
      state.status === 'signedIn' ? { ...state, user: action.payload } : state,
    signedOut: (
      _state,
      action: PayloadAction<SignedOutReason | undefined>,
    ): SessionState =>
      action.payload === undefined
        ? { status: 'signedOut' }
        : { status: 'signedOut', reason: action.payload },
  },
  extraReducers: builder => {
    builder.addCase(
      sessionEnded,
      (): SessionState => ({ status: 'signedOut', reason: 'sessionEnded' }),
    );
  },
  selectors: {
    selectSession: state => state,
    selectSessionStatus: state => state.status,
    selectSessionUser: state =>
      state.status === 'signedIn' ? state.user : null,
    selectSignedOutReason: state =>
      state.status === 'signedOut' ? state.reason : undefined,
  },
});

export const { signedIn, userUpdated, signedOut } = sessionSlice.actions;
export const {
  selectSession,
  selectSessionStatus,
  selectSessionUser,
  selectSignedOutReason,
} = sessionSlice.selectors;

export default sessionSlice.reducer;
