import { validateJWT } from '../middleware/jwt.js';
import { generateCredential, listCredentials, revokeCredential } from '../services/credentials.js';
import { UserModel } from '../db/models/User.js';

async function assertVerified(request, reply) {
  const plan = request.user?.plan;
  if (plan === 'admin' || plan === 'enterprise') return true;
  const user = await UserModel.findById(request.user.id);
  if (!user?.email_verified) {
    reply.code(403).send({ error: 'email_not_verified', message: 'Please verify your email address before creating API credentials.' });
    return false;
  }
  return true;
}

export async function registerCredentialRoutes(fastify) {
  // GET /api/v1/credentials
  fastify.get('/api/v1/credentials', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      const limit = Math.min(parseInt(request.query.limit || '50'), 100);
      const offset = parseInt(request.query.offset || '0');

      const result = await listCredentials(request.user.id, limit, offset);
      return reply.code(200).send(result);
    } catch (error) {
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message,
      });
    }
  });

  // POST /api/v1/credentials
  fastify.post('/api/v1/credentials', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      if (!await assertVerified(request, reply)) return;

      const { name, expires_in_days } = request.body;

      if (!name) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Credential name is required',
        });
      }

      const result = await generateCredential(request.user.id, name, expires_in_days);
      return reply.code(201).send(result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: 'credential_generation_failed',
        message: error.message,
      });
    }
  });

  // DELETE /api/v1/credentials/:credentialId
  fastify.delete('/api/v1/credentials/:credentialId', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      const { credentialId } = request.params;

      await revokeCredential(credentialId, request.user.id);
      return reply.code(204).send();
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: 'revocation_failed',
        message: error.message,
      });
    }
  });
}
