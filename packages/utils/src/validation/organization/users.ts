import * as z from 'zod';

// Admin user-management (Phase 1 Step 7). Roles are the org roleId (ADMIN=1, TUTOR=2,
// LEARNER/STUDENT=3, MANAGER=4). Status is the member_status enum on profile.

export const ZUserRoleId = z.coerce.number().int().min(1).max(4);
export const ZUserStatus = z.enum(['ACTIVE', 'DEACTIVATED']);

export const ZListUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  role: ZUserRoleId.optional(),
  status: ZUserStatus.optional()
});
export type TListUsersQuery = z.infer<typeof ZListUsersQuery>;

export const ZCreateUser = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  roleId: ZUserRoleId
});
export type TCreateUser = z.infer<typeof ZCreateUser>;

export const ZUserMemberParam = z.object({
  memberId: z.coerce.number().int().positive()
});
export type TUserMemberParam = z.infer<typeof ZUserMemberParam>;

export const ZChangeUserRole = z.object({
  roleId: ZUserRoleId
});
export type TChangeUserRole = z.infer<typeof ZChangeUserRole>;

export const ZChangeUserStatus = z.object({
  status: ZUserStatus
});
export type TChangeUserStatus = z.infer<typeof ZChangeUserStatus>;

// Enrolment PII (Admin-only). Light validation only: trim strings, empty → null, DOB is a date.
// No format rules on NI number etc. (deliberately not over-engineered).
const nullableText = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null));

const nullableDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Date of birth must be YYYY-MM-DD');

export const ZLearnerProfile = z.object({
  dateOfBirth: nullableDate,
  niNumber: nullableText,
  gender: nullableText,
  ethnicity: nullableText,
  disability: nullableText,
  address: nullableText,
  aebRegion: nullableText,
  collegeRef: nullableText,
  notes: nullableText
});
export type TLearnerProfileInput = z.infer<typeof ZLearnerProfile>;
