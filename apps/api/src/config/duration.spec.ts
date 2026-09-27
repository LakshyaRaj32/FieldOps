import { parseDurationSeconds } from './duration.js';

describe('parseDurationSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['12h', 43_200],
    ['30d', 2_592_000],
    [' 5m ', 300],
  ])('parses %j as %i seconds', (value, expected) => {
    expect(parseDurationSeconds(value)).toBe(expected);
  });

  it.each(['', '15', 'm', '0m', '-5m', '1.5h', '15 m', '2w', '15min'])(
    'rejects %j',
    value => {
      expect(parseDurationSeconds(value)).toBeUndefined();
    },
  );
});
