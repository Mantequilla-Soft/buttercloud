import { validateJWT } from './jwt.js';
import { UserModel } from '../db/models/User.js';

/**
 * Requires a valid JWT and that the user is currently marked as an admin.
 *
 * Checks is_admin against the database rather than the JWT's plan claim — the
 * JWT is valid for up to JWT_EXPIRATION seconds (7 days by default), so trusting
 * a claim baked in at login would mean revoking someone's admin access doesn't
 * actually take effect until their existing token expires.
 *
 * Sends the appropriate error response itself on failure. Call sites should
 * `return` immediately when this returns false:
 *
 *   if (!(await requireAdmin(request, reply))) return;
 */
export async function requireAdmin(request, reply) {
  await validateJWT(request, reply);
  if (!request.user) return false; // validateJWT already sent 401

  const user = await UserModel.findById(request.user.id);
  if (!user?.is_admin) {
    reply.code(403).send({ error: 'forbidden', message: 'Admin access required' });
    return false;
  }

  return true;
}
