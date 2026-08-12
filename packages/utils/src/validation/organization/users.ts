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
