import crypto from 'crypto';
import { registerUser, loginUser } from '../services/auth.js';
import { UserModel } from '../db/models/User.js';
import { sendVerificationEmail } from '../services/email.js';
import { config } from '../config.js';

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

  // GET /api/v1/me - returns current user profile from JWT + DB
  fastify.get('/api/v1/me', async (request, reply) => {
    try {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized', message: 'No valid token provided' });
      }
      const dbUser = await UserModel.findById(user.id);
      return reply.code(200).send({
        id: user.id,
        email: user.email,
        plan: user.plan,
        email_verified: dbUser?.email_verified ?? false,
      });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });

  // GET /api/v1/auth/verify-email?token=xxx
  fastify.get('/api/v1/auth/verify-email', async (request, reply) => {
    try {
      const { token } = request.query;
      if (!token) return reply.code(400).send({ error: 'missing_token' });

      const user = await UserModel.findByVerificationToken(token);
      if (!user) return reply.code(400).send({ error: 'invalid_token', message: 'Invalid or already used verification link.' });

      if (user.verification_token_expires < new Date()) {
        return reply.code(400).send({ error: 'token_expired', message: 'Verification link has expired. Please request a new one.' });
      }

      await UserModel.update(user._id.toString(), {
        email_verified: true,
        verification_token: null,
        verification_token_expires: null,
      });

      return reply.code(200).send({ message: 'Email verified successfully.' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });

  // POST /api/v1/auth/resend-verification
  fastify.post('/api/v1/auth/resend-verification', async (request, reply) => {
    try {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const dbUser = await UserModel.findById(user.id);
      if (!dbUser) return reply.code(404).send({ error: 'not_found' });
      if (dbUser.email_verified) return reply.code(400).send({ error: 'already_verified' });

      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await UserModel.update(user.id, { verification_token: token, verification_token_expires: expires });

      const baseUrl = config.appUrl || `http://localhost:${config.port}`;
      await sendVerificationEmail({ to: dbUser.email, verifyUrl: `${baseUrl}/verify-email?token=${token}` });

      return reply.code(200).send({ message: 'Verification email sent.' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });
}
