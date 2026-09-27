import { baseApi } from '../../services/api/baseApi';
import type { AppThunk } from '../../store';
import {
  signedIn,
  signedOut,
  userUpdated,
} from '../../store/slices/sessionSlice';
import { logger } from '../../utils/logger';
import { authApi } from './api/authApi';

/**
 * Restores the session at app start.
 *
 * With stored credentials the app opens signed in immediately, using the last known
 * profile, so a field worker without signal can still use the app. The profile is then
 * revalidated with GET /auth/me in the background:
 * - success: the profile is updated (for example a changed role)
 * - session ended (refresh rejected): the base query signs the user out
 * - offline or server error: the user stays signed in
 */
export const restoreSession =
  (): AppThunk<Promise<void>> =>
  async (dispatch, _getState, { credentials }) => {
    const stored = await credentials.load();
    if (stored === undefined) {
      dispatch(signedOut(undefined));
      return;
    }
    dispatch(signedIn(stored.user));

    const result = await dispatch(
      authApi.endpoints.me.initiate(undefined, {
        subscribe: false,
        forceRefetch: true,
      }),
    );
    if (result.data !== undefined) {
      await credentials.updateUser(result.data);
      dispatch(userUpdated(result.data));
    }
  };

/**
 * Signs out on this device.
 *
 * The server session is revoked first (POST /auth/logout), but local sign-out never
 * depends on it: if the phone is offline the credentials are still removed, and the
 * orphaned server session expires on its own (revocation of all sessions arrives with
 * logout-all).
 */
export const signOut =
  (): AppThunk<Promise<void>> =>
  async (dispatch, _getState, { credentials }) => {
    if (credentials.getAccessToken() !== undefined) {
      const result = await dispatch(authApi.endpoints.logout.initiate());
      if ('error' in result) {
        logger.warn('Server sign-out failed; signing out locally');
      }
    }
    await credentials.clear();
    dispatch(signedOut('signedOut'));
    // Next user never sees the previous user's cached server data.
    dispatch(baseApi.util.resetApiState());
  };
