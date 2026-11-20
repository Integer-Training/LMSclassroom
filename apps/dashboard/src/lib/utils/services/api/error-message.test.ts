import { normalizeErrorMessage, GENERIC_ERROR_MESSAGE } from './error-message';

describe('normalizeErrorMessage', () => {
  it('passes strings through', () => {
    expect(normalizeErrorMessage('Nope')).toBe('Nope');
  });
  it('reads { error: string }', () => {
    expect(normalizeErrorMessage({ success: false, error: 'Forbidden' })).toBe('Forbidden');
  });
  it('uses the custom zod issue message from a validator 400 body', () => {
    const body = {
      success: false,
      error: {
        name: 'ZodError',
        message: JSON.stringify([
          { code: 'too_big', path: ['feedback'], message: 'Feedback is too long — maximum 20,000 characters' }
        ])
      }
    };
    expect(normalizeErrorMessage(body)).toBe('Feedback is too long — maximum 20,000 characters');
  });
  it('reads { error: { issues } } and falls back to path: message for default messages', () => {
    expect(normalizeErrorMessage({ error: { issues: [{ path: ['result'], message: 'Invalid input' }] } })).toBe(
      'result: Invalid input'
    );
  });
  it('parses JSON text (ApiError message)', () => {
    expect(normalizeErrorMessage(JSON.stringify({ success: false, error: 'Bad thing' }))).toBe('Bad thing');
  });
  it('reads { message }', () => {
    expect(normalizeErrorMessage({ message: 'Hi' })).toBe('Hi');
  });
  it('falls back for unknown shapes', () => {
    expect(normalizeErrorMessage({})).toBe(GENERIC_ERROR_MESSAGE);
    expect(normalizeErrorMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(normalizeErrorMessage(42)).toBe(GENERIC_ERROR_MESSAGE);
  });
});
