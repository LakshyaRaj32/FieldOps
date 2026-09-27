import type { JwtService } from '@nestjs/jwt';

import type { PushMessage, PushResult, PushSender } from './push-sender.js';

/** The fields of a Firebase service-account JSON file that FCM needs. */
export interface FcmServiceAccount {
  readonly projectId: string;
  readonly clientEmail: string;
  /** PEM-encoded RSA private key. Never logged. */
  readonly privateKey: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const REQUEST_TIMEOUT_MS = 10_000;
/** Renew the OAuth access token this long before it expires. */
const RENEW_MARGIN_MS = 60_000;

/** Android notification channel created by the app (MainApplication.kt). */
export const ANDROID_CHANNEL_ID = 'jobs';

/** Parses a service-account file's JSON; throws a message naming what is missing. */
export function parseServiceAccount(json: unknown): FcmServiceAccount {
  const record =
    typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)
      : {};
  const field = (name: string): string => {
    const value = record[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`The FCM service-account file has no "${name}".`);
    }
    return value;
  };
  return {
    projectId: field('project_id'),
    clientEmail: field('client_email'),
    privateKey: field('private_key'),
  };
}

/**
 * Whether FCM says the registration token itself is bad (the app was uninstalled, the token
 * expired or was never valid). Other 4xx answers (for example a payload FieldOps built
 * wrongly) must not delete a device's registration.
 */
export function isInvalidTokenResponse(status: number, body: unknown): boolean {
  if (status === 404) {
    return true;
  }
  const details = (body as { error?: { details?: unknown } } | null)?.error
    ?.details;
  if (!Array.isArray(details)) {
    return false;
  }
  return details.some((detail: unknown) => {
    const record = detail as {
      errorCode?: unknown;
      fieldViolations?: unknown;
    } | null;
    if (record?.errorCode === 'UNREGISTERED') {
      return true;
    }
    return (
      status === 400 &&
      Array.isArray(record?.fieldViolations) &&
      record.fieldViolations.some(
        (violation: unknown) =>
          (violation as { field?: unknown } | null)?.field === 'message.token',
      )
    );
  });
}

/**
 * Sends through the FCM HTTP v1 API. Authentication is Google's OAuth 2.0 service-account
 * flow: a JWT assertion signed (RS256) with the service account's key through @nestjs/jwt
 * (jsonwebtoken, already a dependency) is exchanged for a one-hour access token, cached and
 * renewed before it expires. No Firebase Admin SDK is needed for this one call
 * (docs/technology-decisions.md, "Push notifications").
 */
export class FcmPushSender implements PushSender {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private renewing: Promise<string> | null = null;

  constructor(
    private readonly account: FcmServiceAccount,
    private readonly jwt: JwtService,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async send(token: string, message: PushMessage): Promise<PushResult> {
    let bearer: string;
    try {
      bearer = await this.authorization();
    } catch {
      return 'failed';
    }
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
          this.account.projectId,
        )}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: {
                priority: 'high',
                notification: { channel_id: ANDROID_CHANNEL_ID },
              },
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      return 'failed';
    }
    if (response.ok) {
      return 'sent';
    }
    if (response.status === 401) {
      this.accessToken = null;
    }
    const body: unknown = await response.json().catch(() => null);
    return isInvalidTokenResponse(response.status, body)
      ? 'invalid_token'
      : 'failed';
  }

  /** A valid OAuth access token; concurrent callers share one renewal. */
  private authorization(): Promise<string> {
    const cached = this.accessToken;
    if (cached !== null && cached.expiresAt - RENEW_MARGIN_MS > this.now()) {
      return Promise.resolve(cached.value);
    }
    this.renewing ??= this.renew().finally(() => {
      this.renewing = null;
    });
    return this.renewing;
  }

  private async renew(): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1000);
    const assertion = this.jwt.sign(
      {
        iss: this.account.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      },
      { algorithm: 'RS256', privateKey: this.account.privateKey },
    );
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OAuth token request failed (${response.status})`);
    }
    const body = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof body.access_token !== 'string' ||
      typeof body.expires_in !== 'number'
    ) {
      throw new Error('OAuth token response is malformed');
    }
    this.accessToken = {
      value: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }
}
