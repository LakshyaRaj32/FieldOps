import { routeFor } from './notificationRouting';

const JOB_ID = '0190c0aa-1111-7abc-8def-0123456789ab';

describe('routeFor', () => {
  it('opens the job for assignment, cancellation, completion and message notifications', () => {
    for (const type of [
      'JOB_ASSIGNED',
      'JOB_CANCELLED',
      'JOB_COMPLETED',
      'JOB_MESSAGE',
    ]) {
      expect(routeFor({ type, jobId: JOB_ID })).toEqual({
        screen: 'job',
        jobId: JOB_ID,
      });
    }
  });

  it('opens the inbox for a job that was taken away', () => {
    expect(routeFor({ type: 'JOB_UNASSIGNED', jobId: JOB_ID })).toEqual({
      screen: 'inbox',
    });
  });

  it('ignores unknown types and malformed job IDs (untrusted push data)', () => {
    expect(routeFor({ type: 'PROMOTION', jobId: JOB_ID })).toBeNull();
    expect(routeFor({ type: 'JOB_ASSIGNED', jobId: '../../admin' })).toBeNull();
    expect(routeFor({ type: 'JOB_ASSIGNED' })).toBeNull();
    expect(routeFor({})).toBeNull();
  });
});
