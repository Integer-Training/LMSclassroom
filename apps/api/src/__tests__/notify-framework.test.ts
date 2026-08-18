import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 6 Step 2 — the ONE notification pipeline (docs/COMMS-MODEL.md §2). Proves: an in-app row is
// ALWAYS written per recipient; email is sent only when the recipient's per-category preference is on (config
// default when no row); the coalescing gate suppresses a repeat email; and the whole emit is failure-isolated
// (an in-app or email failure never throws to the caller). DB queries + mailer are mocked.

vi.mock('@cio/db/queries/comms', () => ({
  insertNotification: vi.fn(async () => ({ id: 'n1' })),
  getNotificationPreference: vi.fn(async () => null),
  hasRecentUnreadForEntity: vi.fn(async () => false)
}));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn(async () => ({ jobIds: ['j1'] })) }));

import { insertNotification, getNotificationPreference, hasRecentUnreadForEntity } from '@cio/db/queries/comms';
import { enqueueTransactionalEmail } from '@api/services/jobs';
import { emitNotification, getCategoryEmailEnabled } from '@api/services/comms/notify';
import { NOTIFICATION_EMAIL_DEFAULTS, categoryForNotificationType } from '@cio/utils/constants';

const mInsert = vi.mocked(insertNotification);
const mPref = vi.mocked(getNotificationPreference);
const mCoalesce = vi.mocked(hasRecentUnreadForEntity);
const mEnqueue = vi.mocked(enqueueTransactionalEmail);

beforeEach(() => {
  vi.clearAllMocks();
  mInsert.mockResolvedValue({ id: 'n1' } as never);
  mPref.mockResolvedValue(null as never);
  mCoalesce.mockResolvedValue(false);
});

describe('config — categories + defaults (D3)', () => {
  it('type → category mapping', () => {
    expect(categoryForNotificationType('submission.created')).toBe('coursework');
    expect(categoryForNotificationType('message.received')).toBe('messaging');
    expect(categoryForNotificationType('announcement.published')).toBe('announcement');
    expect(categoryForNotificationType('session.unlocked')).toBe('session');
  });
  it('email defaults: coursework/messaging/registration ON, announcement/session OFF', () => {
    expect(NOTIFICATION_EMAIL_DEFAULTS).toEqual({
      coursework: true,
      messaging: true,
      announcement: false,
      session: false,
      registration: true // PearlLMS Phase 7 — staff-actionable, email default ON
    });
  });
});

describe('getCategoryEmailEnabled — preference row else config default', () => {
  it('no row → config default (coursework → true)', async () => {
    mPref.mockResolvedValue(null as never);
    expect(await getCategoryEmailEnabled('u1', 'coursework')).toBe(true);
  });
  it('no row → config default (session → false)', async () => {
    expect(await getCategoryEmailEnabled('u1', 'session')).toBe(false);
  });
  it('row wins over default', async () => {
    mPref.mockResolvedValue({ emailEnabled: false } as never);
    expect(await getCategoryEmailEnabled('u1', 'coursework')).toBe(false);
    mPref.mockResolvedValue({ emailEnabled: true } as never);
    expect(await getCategoryEmailEnabled('u1', 'session')).toBe(true);
  });
});

describe('emitNotification — in-app always / email per preference', () => {
  const recip = { userId: 'u1', email: 'u1@x.test', emailFields: { courseTitle: 'C' } };

  it('writes an in-app row per recipient (always) with type + entity', async () => {
    await emitNotification({
      type: 'result.recorded',
      recipients: [{ userId: 'a' }, { userId: 'b' }],
      entityType: 'lesson',
      entityId: 'l1'
    });
    expect(mInsert).toHaveBeenCalledTimes(2);
    expect(mInsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'a', type: 'result.recorded', entityType: 'lesson', entityId: 'l1' })
    );
  });

  it('email sent when category default is on and no preference row', async () => {
    await emitNotification({ type: 'result.recorded', recipients: [recip], emailTemplateId: 'courseworkResulted' });
    expect(mEnqueue).toHaveBeenCalledTimes(1);
    expect(mEnqueue).toHaveBeenCalledWith('courseworkResulted', { to: 'u1@x.test', fields: { courseTitle: 'C' } });
  });

  it('preference OFF → no email, but the in-app row is STILL written', async () => {
    mPref.mockResolvedValue({ emailEnabled: false } as never);
    await emitNotification({ type: 'result.recorded', recipients: [recip], emailTemplateId: 'courseworkResulted' });
    expect(mEnqueue).not.toHaveBeenCalled();
    expect(mInsert).toHaveBeenCalledTimes(1); // in-app always
  });

  it('config default OFF (announcement) + no pref → no email; in-app still written', async () => {
    await emitNotification({
      type: 'announcement.published',
      recipients: [recip],
      emailTemplateId: 'courseworkResulted' // any template; the gate is the category default
    });
    expect(mEnqueue).not.toHaveBeenCalled();
    expect(mInsert).toHaveBeenCalledTimes(1);
  });

  it('no emailTemplateId → in-app only (session.unlocked style), never emails', async () => {
    mPref.mockResolvedValue({ emailEnabled: true } as never); // even if opted in
    await emitNotification({ type: 'session.unlocked', recipients: [recip], entityType: 'lesson', entityId: 'l9' });
    expect(mInsert).toHaveBeenCalledTimes(1);
    expect(mEnqueue).not.toHaveBeenCalled();
  });

  it('no recipient email → in-app only, no email', async () => {
    await emitNotification({
      type: 'result.recorded',
      recipients: [{ userId: 'u1', email: null }],
      emailTemplateId: 'courseworkResulted'
    });
    expect(mInsert).toHaveBeenCalledTimes(1);
    expect(mEnqueue).not.toHaveBeenCalled();
  });
});

describe('emitNotification — coalescing (messaging)', () => {
  const recip = { userId: 'u1', email: 'u1@x.test', emailFields: {} };
  it('a recent unread for the same thread → email suppressed (in-app still written)', async () => {
    mCoalesce.mockResolvedValue(true);
    await emitNotification({
      type: 'message.received',
      recipients: [recip],
      entityType: 'message_thread',
      entityId: 't1',
      emailTemplateId: 'courseworkResulted',
      coalesce: true
    });
    expect(mInsert).toHaveBeenCalledTimes(1);
    expect(mEnqueue).not.toHaveBeenCalled();
  });
  it('no recent unread → email sent', async () => {
    mCoalesce.mockResolvedValue(false);
    await emitNotification({
      type: 'message.received',
      recipients: [recip],
      entityType: 'message_thread',
      entityId: 't1',
      emailTemplateId: 'courseworkResulted',
      coalesce: true
    });
    expect(mEnqueue).toHaveBeenCalledTimes(1);
  });
});

describe('emitNotification — failure isolation (never throws to the caller)', () => {
  const recip = { userId: 'u1', email: 'u1@x.test', emailFields: {} };
  it('in-app write throws → emit resolves, and the email leg still runs', async () => {
    mInsert.mockRejectedValue(new Error('db down'));
    await expect(
      emitNotification({ type: 'result.recorded', recipients: [recip], emailTemplateId: 'courseworkResulted' })
    ).resolves.toBeUndefined();
    expect(mEnqueue).toHaveBeenCalledTimes(1); // email attempted despite the in-app failure
  });
  it('email enqueue throws → emit resolves (in-app already written)', async () => {
    mEnqueue.mockRejectedValue(new Error('redis down'));
    await expect(
      emitNotification({ type: 'result.recorded', recipients: [recip], emailTemplateId: 'courseworkResulted' })
    ).resolves.toBeUndefined();
    expect(mInsert).toHaveBeenCalledTimes(1);
  });
});
