import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('HTTP pipeline (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('serves liveness and readiness outside the versioned prefix', async () => {
    const live = await t.http().get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ success: true, data: { status: 'ok' } });

    const ready = await t.http().get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('answers unknown routes with the error envelope (404 NOT_FOUND)', async () => {
    const response = await t.http().get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: expect.any(String),
      },
    });
  });

  it('answers malformed JSON with BAD_REQUEST and no internals', async () => {
    const response = await t
      .http()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(response.body)).not.toMatch(/stack|SyntaxError|at /);
  });

  it('echoes a valid X-Request-Id and generates one otherwise', async () => {
    const echoed = await t
      .http()
      .get('/health/live')
      .set('X-Request-Id', 'mobile-abc123');
    expect(echoed.headers['x-request-id']).toBe('mobile-abc123');

    const generated = await t
      .http()
      .get('/health/live')
      .set('X-Request-Id', 'not valid <script>');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends security headers and hides the framework', async () => {
    const response = await t.http().get('/health/live');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
