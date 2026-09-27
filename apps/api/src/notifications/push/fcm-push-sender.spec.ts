import { generateKeyPairSync } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';

import {
  FcmPushSender,
  isInvalidTokenResponse,
  parseServiceAccount,
  type FcmServiceAccount,
} from './fcm-push-sender.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const account: FcmServiceAccount = {
  projectId: 'fieldops-test',
  clientEmail: 'push@fieldops-test.iam.gserviceaccount.com',
  privateKey,
};

const message = {
  title: 'New job assigned',
  body: 'Open FieldOps to see the details.',
  data: { type: 'JOB_ASSIGNED', jobId: 'job-1', notificationId: 'n-1' },
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
  /** The request body as sent (the sender only sends text bodies). */
  readonly body: string;
}

function fakeFetch(answer: (call: Call) => { status: number; body: unknown }): {
  fetchFn: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const sent = typeof init?.body === 'string' ? init.body : '';
    const call = { url, init: init ?? {}, body: sent };
    calls.push(call);
    const { status, body } = answer(call);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const oauthOk = {
  status: 200,
  body: { access_token: 'ya29.test', expires_in: 3600 },
};

describe('FcmPushSender', () => {
  const jwt = new JwtService();

  it('exchanges a signed service-account assertion, then sends the message', async () => {
    const { fetchFn, calls } = fakeFetch(call =>
      call.url.includes('oauth2')
        ? oauthOk
        : { status: 200, body: { name: 'm' } },
    );
    const sender = new FcmPushSender(account, jwt, fetchFn);

    expect(await sender.send('device-token', message)).toBe('sent');

    const [oauth, send] = calls;
    const form = new URLSearchParams(oauth?.body);
    expect(form.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    const claims = jwt.verify<Record<string, unknown>>(
      form.get('assertion') ?? '',
      {
        publicKey,
        algorithms: ['RS256'],
      },
    );
    expect(claims).toMatchObject({
      iss: account.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });

    expect(send?.url).toBe(
      'https://fcm.googleapis.com/v1/projects/fieldops-test/messages:send',
    );
    expect(new Headers(send?.init.headers).get('Authorization')).toBe(
      'Bearer ya29.test',
    );
    expect(JSON.parse(send?.body ?? '')).toEqual({
      message: {
        token: 'device-token',
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high', notification: { channel_id: 'jobs' } },
      },
    });
  });

  it('reuses the access token until it is about to expire', async () => {
    let now = 1_000_000;
    const { fetchFn, calls } = fakeFetch(call =>
      call.url.includes('oauth2') ? oauthOk : { status: 200, body: {} },
    );
    const sender = new FcmPushSender(account, jwt, fetchFn, () => now);

    await sender.send('a', message);
    await sender.send('b', message);
    expect(calls.filter(call => call.url.includes('oauth2'))).toHaveLength(1);

    now += 3_550_000; // inside the renewal margin
    await sender.send('c', message);
    expect(calls.filter(call => call.url.includes('oauth2'))).toHaveLength(2);
  });

  it('reports an unregistered token as invalid, other failures as failed', async () => {
    const unregistered = fakeFetch(call =>
      call.url.includes('oauth2')
        ? oauthOk
        : {
            status: 404,
            body: { error: { details: [{ errorCode: 'UNREGISTERED' }] } },
          },
    );
    expect(
      await new FcmPushSender(account, jwt, unregistered.fetchFn).send(
        't',
        message,
      ),
    ).toBe('invalid_token');

    const outage = fakeFetch(call =>
      call.url.includes('oauth2') ? oauthOk : { status: 503, body: {} },
    );
    expect(
      await new FcmPushSender(account, jwt, outage.fetchFn).send('t', message),
    ).toBe('failed');
  });

  it('fails without sending when Google refuses the credentials', async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ status: 400, body: {} }));
    const sender = new FcmPushSender(account, jwt, fetchFn);
    expect(await sender.send('t', message)).toBe('failed');
    expect(calls).toHaveLength(1);
  });

  it('fails on a network error', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(
      await new FcmPushSender(account, jwt, fetchFn).send('t', message),
    ).toBe('failed');
  });
});

describe('isInvalidTokenResponse', () => {
  it('only treats token problems as invalid tokens', () => {
    expect(isInvalidTokenResponse(404, null)).toBe(true);
    expect(
      isInvalidTokenResponse(400, {
        error: {
          details: [{ fieldViolations: [{ field: 'message.token' }] }],
        },
      }),
    ).toBe(true);
    expect(
      isInvalidTokenResponse(400, {
        error: {
          details: [{ fieldViolations: [{ field: 'message.data' }] }],
        },
      }),
    ).toBe(false);
    expect(isInvalidTokenResponse(500, null)).toBe(false);
  });
});

describe('parseServiceAccount', () => {
  it('reads the three fields FCM needs and names a missing one', () => {
    expect(
      parseServiceAccount({
        project_id: 'p',
        client_email: 'e',
        private_key: 'k',
        type: 'service_account',
      }),
    ).toEqual({ projectId: 'p', clientEmail: 'e', privateKey: 'k' });
    expect(() => parseServiceAccount({ project_id: 'p' })).toThrow(
      '"client_email"',
    );
  });
});
