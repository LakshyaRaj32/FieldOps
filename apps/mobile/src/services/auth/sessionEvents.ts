import { createAction } from '@reduxjs/toolkit';

/**
 * Dispatched by the API layer when the server has definitively ended the session (the
 * refresh token was rejected: expired, revoked or reused). Declared here, outside the
 * session slice, so the API layer can raise it without importing the store.
 */
export const sessionEnded = createAction('auth/sessionEnded');
