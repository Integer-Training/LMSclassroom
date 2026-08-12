// The central guard layer — role requirements + ownership/scope predicates, all built on the
// resolved Actor (c.get('actor')). Route groups compose these; deny-by-default throughout.
// See docs/ACCESS.md for the target matrix and the gap-closure map.

export {
  requireActor,
  requireRole,
  requireAdmin,
  requireStaff,
  requireManagerOrAdmin,
  requireAdminOrApiKey,
  unauthorized,
  forbidden
} from './require-role';

export { requireSameOrg, requireSelfParam, requireMarkingAccess, bindSubmissionToCourse, notFound } from './ownership';

export { publicRoute } from './public';
