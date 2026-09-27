import { useCallback, useState } from 'react';
import type { LoginRequest, RegisterRequest } from '@fieldops/types';

import { useAppDispatch } from '../../store/hooks';
import { toAppError, type AppError } from '../../utils/errors';
import { authApi } from './api/authApi';

export interface SignInRequestState {
  readonly isLoading: boolean;
  readonly error: AppError | undefined;
}

/**
 * Runs the login or register mutation WITHOUT tracking it in the store (`track: false`).
 * RTK Query otherwise keeps a mutation's arguments in Redux state, which here would be the
 * user's password. Loading and error state live in the component instead.
 *
 * On success the session state switches the navigator, which unmounts the screen.
 */
export function useSignIn<Endpoint extends 'login' | 'register'>(
  endpoint: Endpoint,
) {
  const dispatch = useAppDispatch();
  const [state, setState] = useState<SignInRequestState>({
    isLoading: false,
    error: undefined,
  });

  const submit = useCallback(
    async (
      body: Endpoint extends 'login' ? LoginRequest : RegisterRequest,
    ): Promise<void> => {
      setState({ isLoading: true, error: undefined });
      const result = await dispatch(
        authApi.endpoints[endpoint].initiate(body, { track: false }),
      );
      if ('error' in result) {
        setState({ isLoading: false, error: toAppError(result.error) });
      }
    },
    [dispatch, endpoint],
  );

  const reset = useCallback(
    () => setState({ isLoading: false, error: undefined }),
    [],
  );

  return { submit, reset, ...state };
}
