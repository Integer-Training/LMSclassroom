import { AppError, ErrorCodes } from '@api/utils/errors';
import { z } from 'zod';
import { env } from '@cio/core/config/env';
import { getFirstOrganization, checkEmailExistsInOrg, getOrgManagersAndAdmins } from '@cio/db/queries/organization';
import { getCourseEnrolmentTarget } from '@cio/db/queries/onboarding';
import { insertRegistration, hasOpenRegistrationForEmail } from '@cio/db/queries/registration';
import { listPublishedCoursesForOrg } from '@cio/db/queries/onboarding';
import { emitNotification } from '@api/services/comms/notify';
import { hitRegistrationRateLimit } from '@api/services/registration/rate-limit';

// PearlLMS Phase 7 — the public registration intake (docs/ONBOARDING-MODEL.md §5/§8/§9). This service NEVER
// touches the auth stack: it writes ONLY a pending `registration` row and notifies staff. No user, no session,
// no credential. The pending row is inert until a Manager/Admin approves it (Step 3, which composes the
// Phase-5 onboardLearner service). Self-hosted single-provider: the target org is the sole organization.

const ZSubmit = z.object({
  fullName: z.string().trim().min(1, 'Please enter your name').max(200),
  email: z.string().trim().toLowerCase().email('Please enter a valid email'),
  requestedCourseId: z.string().uuid().optional().nullable()
});

export interface SubmitRegistrationInput {
  fullName: string;
  email: string;
  requestedCourseId?: string | null;
  /** Hidden honeypot field value — a real visitor leaves it empty. */
  honeypot?: string | null;
  /** Client IP (resolved from the request at the boundary) for the per-IP rate limit. */
  clientIp: string;
}

export interface SubmitRegistrationResult {
  ok: true;
  /** true when a bot-filled honeypot caused a silent drop (looks successful, nothing written). */
  dropped?: boolean;
}

/** Resolve the sole organization for the closed single-provider deployment. */
async function resolveTargetOrg(): Promise<{ id: string }> {
  const org = await getFirstOrganization();
  if (!org) {
    throw new AppError('Registration is not available right now.', ErrorCodes.INTERNAL_ERROR, 503);
  }
  return { id: org.id };
}

export async function submitRegistration(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult> {
  // 1. Honeypot — a bot filled the hidden field. Silently drop: look successful, write nothing, notify no one.
  if (input.honeypot != null && input.honeypot.trim() !== '') {
    return { ok: true, dropped: true };
  }

  // 2. Per-IP rate limit (config-driven backstop).
  if (!hitRegistrationRateLimit(input.clientIp)) {
    throw new AppError('Too many registration attempts. Please try again shortly.', 'RATE_LIMITED', 429);
  }

  // 3. Validate the payload.
  const parsed = ZSubmit.safeParse({
    fullName: input.fullName,
    email: input.email,
    requestedCourseId: input.requestedCourseId ?? null
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(
      first?.message ?? 'Invalid registration',
      ErrorCodes.VALIDATION_ERROR,
      400,
      first?.path?.[0]?.toString()
    );
  }
  const { fullName, email, requestedCourseId } = parsed.data;

  // 4. Resolve the target org (sole org, self-hosted).
  const org = await resolveTargetOrg();

  // 5. Validate the requested course (if any): must be a published course in this org.
  if (requestedCourseId) {
    const target = await getCourseEnrolmentTarget(requestedCourseId);
    if (!target || target.orgId !== org.id || !target.isPublished) {
      throw new AppError(
        'The selected course is not available.',
        ErrorCodes.VALIDATION_ERROR,
        400,
        'requestedCourseId'
      );
    }
  }

  // 6. Duplicate-email refusal (neutral, no enumeration): an existing member OR an open pending application.
  const [alreadyMember, alreadyPending] = await Promise.all([
    checkEmailExistsInOrg(org.id, email),
    hasOpenRegistrationForEmail(org.id, email)
  ]);
  if (alreadyMember || alreadyPending) {
    throw new AppError(
      'If you already have an account or a pending application, please sign in or contact us.',
      ErrorCodes.CONFLICT,
      409,
      'email'
    );
  }

  // 7. Write the pending row (the ONLY write — no auth records).
  const row = await insertRegistration({
    organizationId: org.id,
    fullName,
    email,
    requestedCourseId: requestedCourseId ?? null
  });

  // 8. Notify Managers + Admins through the Phase-6 framework (in-app always + email per pref). Best-effort:
  //    a notification failure must never fail the applicant's submission. Content-light — no applicant PII.
  try {
    const recipients = await getOrgManagersAndAdmins(org.id);
    if (recipients.length > 0) {
      const registrationsUrl = `${env.DASHBOARD_ORIGIN ?? ''}/registrations`;
      await emitNotification({
        type: 'registration.submitted',
        recipients: recipients.map((r) => ({
          userId: r.userId,
          email: r.email || null,
          emailFields: { registrationsUrl }
        })),
        entityType: 'registration',
        entityId: row.id,
        emailTemplateId: 'registrationSubmitted'
      });
    }
  } catch (error) {
    console.error('[registration] staff notification failed (continuing):', error);
  }

  return { ok: true };
}

/** Published courses for the public form's "course of interest" picker (sole org). Id + title only. */
export async function listRegistrationCourses(): Promise<{ courseId: string; title: string | null }[]> {
  const org = await resolveTargetOrg();
  return listPublishedCoursesForOrg(org.id);
}
