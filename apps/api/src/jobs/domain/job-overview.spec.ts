import { JobStatus } from '../job-enums.js';
import { statusCounts, workload } from './job-overview.js';

const person = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: 'Test',
});

describe('job overview', () => {
  it('reports every status, with 0 for statuses without jobs', () => {
    expect(
      statusCounts([
        { status: JobStatus.PENDING, count: 2 },
        { status: JobStatus.COMPLETED, count: 5 },
      ]),
    ).toEqual({
      PENDING: 2,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 5,
      CANCELLED: 0,
    });
  });

  it('combines each worker’s assigned and in-progress jobs, busiest first', () => {
    const asha = person('w-1', 'Asha');
    const ravi = person('w-2', 'Ravi');
    const meera = person('w-3', 'Meera');

    expect(
      workload(
        [
          { workerId: 'w-1', status: JobStatus.ASSIGNED, count: 1 },
          { workerId: 'w-2', status: JobStatus.ASSIGNED, count: 2 },
          { workerId: 'w-2', status: JobStatus.IN_PROGRESS, count: 1 },
          { workerId: 'w-3', status: JobStatus.IN_PROGRESS, count: 1 },
        ],
        [asha, ravi, meera],
      ),
    ).toEqual([
      { worker: ravi, assigned: 2, inProgress: 1 },
      // Equal load: by name.
      { worker: asha, assigned: 1, inProgress: 0 },
      { worker: meera, assigned: 0, inProgress: 1 },
    ]);
  });

  it('caps the list and skips workers it cannot name', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      workerId: `w-${index}`,
      status: JobStatus.ASSIGNED,
      count: index + 1,
    }));
    const workers = rows.map(row => person(row.workerId, row.workerId));

    const result = workload(rows, workers, 10);
    expect(result).toHaveLength(10);
    expect(result[0]?.assigned).toBe(12);

    expect(
      workload(
        [{ workerId: 'gone', status: JobStatus.ASSIGNED, count: 3 }],
        [],
      ),
    ).toEqual([]);
  });
});
