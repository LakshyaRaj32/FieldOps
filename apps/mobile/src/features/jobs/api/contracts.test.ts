import { serverJob, WORKER } from '../../../testing/fakeJobServer';
import { isJobDetail } from './contracts';

describe('isJobDetail (Phase 4 fields)', () => {
  const evidence = {
    id: 'evidence-1',
    contentType: 'image/jpeg',
    sizeBytes: 100,
    width: 10,
    height: 10,
    uploadedBy: WORKER,
    capturedAt: '2026-09-27T09:00:00.000Z',
    createdAt: '2026-09-27T09:01:00.000Z',
  };
  const location = {
    latitude: 12.97,
    longitude: 77.59,
    accuracyMeters: 9,
    capturedAt: '2026-09-27T09:00:00.000Z',
    distanceMeters: 40,
  };

  it('accepts locations, evidence and messages', () => {
    expect(
      isJobDetail(
        serverJob({
          startLocation: location,
          completeLocation: { ...location, distanceMeters: null },
          evidence: [evidence] as never,
          messages: [
            {
              id: 'm-1',
              body: 'Hi',
              author: WORKER,
              occurredAt: '2026-09-27T09:00:00.000Z',
              createdAt: '2026-09-27T09:00:01.000Z',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('refuses evidence of an unexpected type and malformed locations', () => {
    expect(
      isJobDetail(
        serverJob({
          evidence: [{ ...evidence, contentType: 'text/html' }] as never,
        }),
      ),
    ).toBe(false);
    expect(
      isJobDetail(
        serverJob({
          startLocation: { ...location, latitude: 'north' } as never,
        }),
      ),
    ).toBe(false);
  });

  it('refuses a job without the Phase 4 fields (an older server)', () => {
    const { evidence: _omitted, ...older } = serverJob();
    void _omitted;
    expect(isJobDetail(older)).toBe(false);
  });
});
