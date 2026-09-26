import type {
  LoginRequest,
  RegisterRequest,
  UserProfile,
} from '@fieldops/types';

import { API_V1, baseApi, servicesOf } from '../../../services/api/baseApi';
import { isAuthResult, isUserProfile } from '../../../services/auth/contracts';
import { signedIn } from '../../../store/slices/sessionSlice';
import { parseError } from '../../../utils/errors';

/**
 * Authentication endpoints.
 *
 * Register and login use `queryFn` so the token pair goes straight from the HTTP response
 * into the credential store: the mutation's result is only the user profile, so tokens
 * never enter Redux state, actions or devtools. They are dispatched untracked (see
 * useSignIn) so the password in the arguments is not kept in the store either.
 *
 * Refresh is not an endpoint here: the base query performs it transparently on 401.
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: build => {
    const signInMutation = (path: string) =>
      build.mutation<UserProfile, LoginRequest | RegisterRequest>({
        async queryFn(body, api, _extraOptions, baseQuery) {
          const result = await baseQuery({
            url: `${API_V1}/auth/${path}`,
            method: 'POST',
            body,
          });
          if (result.error !== undefined) {
            return { error: result.error };
          }
          if (!isAuthResult(result.data)) {
            return { error: parseError(`Unexpected ${path} response`) };
          }
          const services = servicesOf(api);
          if (services === undefined) {
            return { error: parseError('Credential store unavailable') };
          }
          await services.credentials.save(result.data);
          api.dispatch(signedIn(result.data.user));
          return { data: result.data.user };
        },
      });

    return {
      login: signInMutation('login'),
      register: signInMutation('register'),
      logout: build.mutation<null, void>({
        query: () => ({ url: `${API_V1}/auth/logout`, method: 'POST' }),
      }),
      me: build.query<UserProfile, void>({
        query: () => `${API_V1}/auth/me`,
        transformResponse: (body: unknown) => {
          if (!isUserProfile(body)) {
            throw new Error('Unexpected /auth/me response');
          }
          return body;
        },
        keepUnusedDataFor: 0,
      }),
    };
  },
});
