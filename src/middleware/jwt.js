import { verifyToken } from '../services/auth.js';

/**
 * JWT authentication middleware for Admin API
 */
export async function validateJWT(request, reply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.code(401).send({
      error: 'invalid_token',
      message: 'Invalid or expired token',
    });
  }

  // Attach user info to request
  request.user = {
    id: decoded.sub,
    email: decoded.email,
    plan: decoded.plan,
  };
}

/**
 * Optional JWT middleware (attaches user if present, but doesn't require it)
 */
export async function optionalJWT(request, reply) {
  const authHeader = request.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (decoded) {
      request.user = {
        id: decoded.sub,
        email: decoded.email,
        plan: decoded.plan,
      };
    }
  }
}
