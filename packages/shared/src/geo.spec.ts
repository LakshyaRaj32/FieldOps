import { distanceMeters, isValidCoordinates } from './geo';

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    const point = { latitude: 12.9716, longitude: 77.5946 };
    expect(distanceMeters(point, point)).toBe(0);
  });

  it('matches a known city distance (Bengaluru to Chennai, about 290 km)', () => {
    const bengaluru = { latitude: 12.9716, longitude: 77.5946 };
    const chennai = { latitude: 13.0827, longitude: 80.2707 };
    const km = distanceMeters(bengaluru, chennai) / 1000;
    expect(km).toBeGreaterThan(288);
    expect(km).toBeLessThan(292);
  });

  it('measures short field distances in meters (0.001° of latitude ≈ 111 m)', () => {
    const site = { latitude: 28.6139, longitude: 77.209 };
    const worker = { latitude: 28.6149, longitude: 77.209 };
    expect(Math.round(distanceMeters(site, worker))).toBe(111);
  });

  it('is symmetric', () => {
    const a = { latitude: -33.8688, longitude: 151.2093 };
    const b = { latitude: 51.5072, longitude: -0.1276 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  it('handles the antimeridian and antipodes', () => {
    const west = { latitude: 0, longitude: 179.9999 };
    const east = { latitude: 0, longitude: -179.9999 };
    expect(distanceMeters(west, east)).toBeLessThan(30);
    const antipode = distanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 180 },
    );
    expect(antipode / 1000).toBeCloseTo(20_015, 0);
  });

  it('refuses coordinates outside WGS 84 bounds', () => {
    const ok = { latitude: 0, longitude: 0 };
    expect(() => distanceMeters(ok, { latitude: 91, longitude: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      distanceMeters(ok, { latitude: 0, longitude: Number.NaN }),
    ).toThrow(RangeError);
  });
});

describe('isValidCoordinates', () => {
  it.each([
    [{ latitude: 90, longitude: 180 }, true],
    [{ latitude: -90, longitude: -180 }, true],
    [{ latitude: 90.0001, longitude: 0 }, false],
    [{ latitude: 0, longitude: -180.5 }, false],
    [{ latitude: Number.POSITIVE_INFINITY, longitude: 0 }, false],
  ])('%j → %s', (value, expected) => {
    expect(isValidCoordinates(value)).toBe(expected);
  });
});
