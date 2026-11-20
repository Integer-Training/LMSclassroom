import { describe, it, expect } from 'vitest';
import { ZMarkSubmission } from '@cio/utils/validation/coursework';
import { MAX_FEEDBACK_LENGTH } from '@cio/utils/constants';

describe('ZMarkSubmission feedback length', () => {
  it('accepts feedback of exactly the maximum length (20,000)', () => {
    expect(MAX_FEEDBACK_LENGTH).toBe(20000);
    expect(ZMarkSubmission.safeParse({ feedback: 'a'.repeat(20000) }).success).toBe(true);
  });

  it('rejects 20,001 chars with the custom message', () => {
    const r = ZMarkSubmission.safeParse({ feedback: 'a'.repeat(20001) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe('Feedback is too long — maximum 20,000 characters');
    }
  });

  it('accepts the previously-rejected 5,001+ char feedback', () => {
    expect(ZMarkSubmission.safeParse({ feedback: 'a'.repeat(6000) }).success).toBe(true);
  });
});
