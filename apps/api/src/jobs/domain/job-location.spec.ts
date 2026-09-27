import { eventLocation } from './job-location.js';

const fix = {
  latitude: 28.6149,
  longitude: 77.209,
  accuracyMeters: 8,
  capturedAt: '2026-09-27T10:40:00+05:30',
};

describe('eventLocation', () => {
  it('computes the distance from the job site on the server, rounded to meters', () => {
    const location = eventLocation({ latitude: 28.6139, longitude: 77.209 }, fix);
    expect(location).toEqual({
      latitude: 28.6149,
      longitude: 77.209,
      accuracyMeters: 8,
      locatedAt: new Date('2026-09-27T05:10:00.000Z'),
      distanceMeters: 111,
    });
  });

  it('records the fix without a distance when the job has no coordinates', () => {
    expect(
      eventLocation({ latitude: null, longitude: null }, fix).distanceMeters,
    ).toBeNull();
  });
});
