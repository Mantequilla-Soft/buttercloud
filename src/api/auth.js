import { registerUser, loginUser } from '../services/auth.js';

export async function registerAuthRoutes(fastify) {
  // POST /api/v1/auth/signup
  fastify.post('/api/v1/auth/signup', async (request, reply) => {
    try {
      const { email, password, company_name } = request.body;

      // Validate input
      if (!email || !password) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Email and password are required',
        });
      }

      const result = await registerUser(email, password, company_name);
      return reply.code(201).send(result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: 'registration_failed',
        message: error.message,
      });
    }
  });

  // POST /api/v1/auth/login
  fastify.post('/api/v1/auth/login', async (request, reply) => {
    try {
      const { email, password } = request.body;

      // Validate input
      if (!email || !password) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'Email and password are required',
        });
      }

      const result = await loginUser(email, password);
      return reply.code(200).send(result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: 'login_failed',
        message: error.message,
      });
    }
  });

  // POST /api/v1/auth/logout
  fastify.post('/api/v1/auth/logout', async (request, reply) => {
    // Stateless JWT - logout is a client operation (discard token)
    return reply.code(204).send();
  });

  // GET /api/v1/me - returns current user profile from JWT
  fastify.get('/api/v1/me', async (request, reply) => {
    try {
      const user = request.user; // set by jwt.js middleware
      if (!user) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'No valid token provided',
        });
      }
      return reply.code(200).send({
        id: user.id,
        email: user.email,
        plan: user.plan,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'server_error',
        message: error.message,
      });
    }
  });
}
