import { JobPriority, JobStatus, type JobDetail } from '@fieldops/types';

import {
  emptyJobForm,
  jobToForm,
  parseSchedule,
  toCreateJobRequest,
  toUpdateJobRequest,
  validateJobForm,
  type JobForm,
} from './jobForm';

const filledForm = (overrides: Partial<JobForm> = {}): JobForm => ({
  ...emptyJobForm(new Date(2026, 8, 26, 14, 20)),
  title: ' AC repair ',
  customerName: 'ABC Ltd',
  address: '12 MG Road',
  checklist: 'Isolate power\n\n  Clean filters  \n',
  ...overrides,
});

const job: JobDetail = {
  id: 'job-1',
  title: 'AC repair',
  customerName: 'ABC Ltd',
  address: '12 MG Road',
  scheduledAt: new Date(2026, 8, 27, 10, 30).toISOString(),
  priority: JobPriority.NORMAL,
  status: JobStatus.ASSIGNED,
  assignedWorker: { id: 'w1', firstName: 'Asha', lastName: 'Verma' },
  version: 3,
  updatedAt: '2026-09-26T10:00:00.000Z',
  allowedActions: ['assign', 'edit', 'cancel'],
  description: 'Not cooling',
  location: null,
  notes: null,
  checklist: [{ id: 'c1', position: 0, label: 'Clean filters' }],
  cancellationReason: null,
  createdBy: { id: 'm1', firstName: 'Ravi', lastName: 'Kumar' },
  createdAt: '2026-09-26T09:00:00.000Z',
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  history: [],
};

describe('emptyJobForm', () => {
  it('schedules a new job at the next full hour', () => {
    const form = emptyJobForm(new Date(2026, 8, 26, 23, 40));
    expect([form.date, form.time]).toEqual(['2026-09-27', '00:00']);
    expect(form.priority).toBe('NORMAL');
  });
});

describe('validateJobForm', () => {
  it('accepts a complete form', () => {
    expect(validateJobForm(filledForm())).toEqual({});
  });

  it('requires title, customer and address', () => {
    expect(
      Object.keys(
        validateJobForm(
          filledForm({ title: ' ', customerName: '', address: '' }),
        ),
      ),
    ).toEqual(['title', 'customerName', 'address']);
  });

  it.each([
    [{ date: '27/09/2026' }, 'date', 'Use the format YYYY-MM-DD.'],
    [{ time: '9:30' }, 'time', 'Use the 24-hour format HH:MM.'],
    [{ time: '24:00' }, 'time', 'Use the 24-hour format HH:MM.'],
    [{ date: '2026-02-30' }, 'date', 'Enter a real date.'],
  ] as const)('rejects %j', (overrides, field, message) => {
    expect(validateJobForm(filledForm(overrides))[field]).toBe(message);
  });

  it('limits lengths like the API does', () => {
    const errors = validateJobForm(
      filledForm({
        title: 'x'.repeat(201),
        checklist: Array.from({ length: 51 }, (_, i) => `Item ${i}`).join('\n'),
      }),
    );
    expect(errors.title).toBe('Title must be at most 200 characters.');
    expect(errors.checklist).toBe('Use at most 50 items.');
  });
});

describe('toCreateJobRequest', () => {
  it('trims fields, drops empty optional ones and sends the schedule as ISO', () => {
    const request = toCreateJobRequest(
      filledForm({ date: '2026-09-27', time: '10:30' }),
    );
    expect(request).toEqual({
      title: 'AC repair',
      customerName: 'ABC Ltd',
      address: '12 MG Road',
      scheduledAt: new Date(2026, 8, 27, 10, 30).toISOString(),
      priority: 'NORMAL',
      checklist: ['Isolate power', 'Clean filters'],
    });
  });
});

describe('parseSchedule', () => {
  it('reads the date and time in the device time zone', () => {
    expect(parseSchedule('2026-09-27', '10:30')).toEqual(
      new Date(2026, 8, 27, 10, 30),
    );
  });
});

describe('toUpdateJobRequest', () => {
  it('sends only the version when nothing changed', () => {
    expect(toUpdateJobRequest(jobToForm(job), job)).toEqual({ version: 3 });
  });

  it('sends changed fields, and null for cleared optional texts', () => {
    const form = {
      ...jobToForm(job),
      title: 'AC repair (2 units)',
      description: '  ',
      time: '11:00',
      priority: JobPriority.URGENT,
      checklist: 'Clean filters\nTest cooling',
    };
    expect(toUpdateJobRequest(form, job)).toEqual({
      version: 3,
      title: 'AC repair (2 units)',
      description: null,
      scheduledAt: new Date(2026, 8, 27, 11, 0).toISOString(),
      priority: 'URGENT',
      checklist: ['Clean filters', 'Test cooling'],
    });
  });

  it('never sends a checklist once the job has started', () => {
    const started = { ...job, status: JobStatus.IN_PROGRESS };
    const form = { ...jobToForm(started), checklist: 'Something else' };
    expect(toUpdateJobRequest(form, started)).toEqual({ version: 3 });
  });
});
