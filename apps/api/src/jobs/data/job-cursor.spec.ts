import { decodeJobCursor, encodeJobCursor } from './job-cursor.js';

describe('job cursor', () => {
  it('round-trips the sort key of the last item', () => {
    const cursor = {
      scheduledAt: new Date('2026-09-27T10:30:00.000Z'),
      id: '01927c4e-7a52-7cc1-a3b5-3c8e1f7e2a10',
    };

    const encoded = encodeJobCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeJobCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['not base64 JSON', '%%%'],
    ['JSON that is not a pair', Buffer.from('{"a":1}').toString('base64url')],
    [
      'an invalid date',
      Buffer.from(
        '["tomorrow","01927c4e-7a52-7cc1-a3b5-3c8e1f7e2a10"]',
      ).toString('base64url'),
    ],
    [
      'an invalid id',
      Buffer.from('["2026-09-27T10:30:00.000Z","1 OR 1=1"]').toString(
        'base64url',
      ),
    ],
  ])('rejects %s', (_case, value) => {
    expect(decodeJobCursor(value)).toBeUndefined();
  });
});
