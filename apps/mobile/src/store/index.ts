import {
  combineReducers,
  configureStore,
  type ThunkAction,
  type UnknownAction,
} from '@reduxjs/toolkit';

import { baseApi, type StoreServices } from '../services/api/baseApi';
import { credentialStore } from '../services/auth/credentialStore';
import connectivityReducer from './slices/connectivitySlice';
import sessionReducer from './slices/sessionSlice';

/**
 * Redux holds APPLICATION state (session, connectivity, shared UI state) and RTK Query's
 * SERVER-state cache. It is deliberately small:
 *
 * - it is not a database: persistent relational data lives in SQLite (Version 5)
 * - it is not persisted wholesale to disk
 * - it never holds large collections or location history
 * - it never holds tokens: those live in the credential store (Android Keystore)
 */
const rootReducer = combineReducers({
  session: sessionReducer,
  connectivity: connectivityReducer,
  [baseApi.reducerPath]: baseApi.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export interface CreateAppStoreOptions {
  readonly preloadedState?: Partial<RootState>;
  /** Services available to thunks and the API layer. Tests pass in-memory fakes. */
  readonly services?: StoreServices;
}

export function createAppStore({
  preloadedState,
  services = { credentials: credentialStore },
}: CreateAppStoreOptions = {}) {
  return configureStore({
    reducer: rootReducer,
    ...(preloadedState !== undefined && { preloadedState }),
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({ thunk: { extraArgument: services } }).concat(
        baseApi.middleware,
      ),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
export type AppDispatch = AppStore['dispatch'];
export type AppThunk<Result = void> = ThunkAction<
  Result,
  RootState,
  StoreServices,
  UnknownAction
>;

export const store = createAppStore();
