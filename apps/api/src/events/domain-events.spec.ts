import { Logger } from '@nestjs/common';

import { DomainEvents, type SessionEndedEvent } from './domain-events.js';

const ended: SessionEndedEvent = {
  type: 'session.ended',
  sessionId: 's-1',
};

describe('DomainEvents', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('delivers an event to every handler of its type only', () => {
    const events = new DomainEvents();
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    events.subscribe('session.ended', a);
    events.subscribe('session.ended', b);
    events.subscribe('job.changed', other);

    events.publish(ended);

    expect(a).toHaveBeenCalledWith(ended);
    expect(b).toHaveBeenCalledWith(ended);
    expect(other).not.toHaveBeenCalled();
  });

  it('isolates failing handlers, synchronous or not', async () => {
    const events = new DomainEvents();
    const after = vi.fn();
    events.subscribe('session.ended', () => {
      throw new Error('boom');
    });
    events.subscribe('session.ended', () => Promise.reject(new Error('later')));
    events.subscribe('session.ended', after);

    expect(() => events.publish(ended)).not.toThrow();
    await Promise.resolve();
    expect(after).toHaveBeenCalledOnce();
  });

  it('stops delivering after unsubscribe', () => {
    const events = new DomainEvents();
    const handler = vi.fn();
    const unsubscribe = events.subscribe('session.ended', handler);
    unsubscribe();
    events.publish(ended);
    expect(handler).not.toHaveBeenCalled();
  });
});
