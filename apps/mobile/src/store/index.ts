import { combineReducers, configureStore } from '@reduxjs/toolkit';

import { baseApi } from '../services/api/baseApi';
import connectivityReducer from './slices/connectivitySlice';
import sessionReducer from './slices/sessionSlice';

/**
 * Redux holds APPLICATION state (session, connectivity, shared UI state) and RTK Query's
 * SERVER-state cache. It is deliberately small:
 *
 * - it is not a database: persistent relational data lives in SQLite (Version 5)
 * - it is not persisted wholesale to disk
 * - it never holds large collections or location history
 */
const rootReducer = combineReducers({
  session: sessionReducer,
  connectivity: connectivityReducer,
  [baseApi.reducerPath]: baseApi.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function createAppStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    ...(preloadedState !== undefined && { preloadedState }),
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware().concat(baseApi.middleware),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
export type AppDispatch = AppStore['dispatch'];

export const store = createAppStore();
