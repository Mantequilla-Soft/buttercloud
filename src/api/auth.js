import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { registerUser, loginUser, isStrongPassword } from '../services/auth.js';
import { UserModel } from '../db/models/User.js';
import { BucketModel } from '../db/models/Bucket.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../services/email.js';
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

      // Send welcome email (non-fatal)
      try {
        const bucket = await BucketModel.findByUserId(user._id.toString());
        const baseUrl = config.appUrl || `http://localhost:${config.port}`;
        await sendWelcomeEmail({
          to: user.email,
          bucketName: bucket?.bucket_name || null,
          keysUrl: `${baseUrl}/keys`,
        });
      } catch (e) {
        console.warn('Welcome email failed (non-fatal):', e.message);
      }

      return reply.code(200).send({ message: 'Email verified successfully.' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });

  // POST /api/v1/auth/forgot-password
  fastify.post('/api/v1/auth/forgot-password', async (request, reply) => {
    try {
      const { email } = request.body;
      if (!email) return reply.code(400).send({ error: 'invalid_request', message: 'Email is required' });

      // Always return 200 to avoid leaking whether an email exists
      const user = await UserModel.findByEmail(email);
      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await UserModel.update(user._id.toString(), { reset_token: token, reset_token_expires: expires });

        const baseUrl = config.appUrl || `http://localhost:${config.port}`;
        try {
          await sendPasswordResetEmail({ to: user.email, resetUrl: `${baseUrl}/reset-password?token=${token}` });
        } catch (e) {
          console.warn('Password reset email failed (non-fatal):', e.message);
        }
      }

      return reply.code(200).send({ message: 'If an account with that email exists, a reset link has been sent.' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });

  // POST /api/v1/auth/reset-password
  fastify.post('/api/v1/auth/reset-password', async (request, reply) => {
    try {
      const { token, new_password } = request.body;
      if (!token || !new_password) {
        return reply.code(400).send({ error: 'invalid_request', message: 'Token and new password are required' });
      }

      const user = await UserModel.findByResetToken(token);
      if (!user) return reply.code(400).send({ error: 'invalid_token', message: 'Invalid or already used reset link.' });

      if (user.reset_token_expires < new Date()) {
        return reply.code(400).send({ error: 'token_expired', message: 'Reset link has expired. Please request a new one.' });
      }

      if (!isStrongPassword(new_password)) {
        return reply.code(400).send({ error: 'weak_password', message: 'Password must be at least 8 characters with uppercase, lowercase, and numbers' });
      }

      const password_hash = await bcrypt.hash(new_password, 12);
      await UserModel.update(user._id.toString(), {
        password_hash,
        reset_token: null,
        reset_token_expires: null,
      });

      return reply.code(200).send({ message: 'Password has been reset. You can now log in.' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });

  // POST /api/v1/auth/change-password (requires auth)
  fastify.post('/api/v1/auth/change-password', async (request, reply) => {
    try {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const { current_password, new_password } = request.body;
      if (!current_password || !new_password) {
        return reply.code(400).send({ error: 'invalid_request', message: 'Current and new passwords are required' });
      }

      const dbUser = await UserModel.findById(user.id);
      if (!dbUser) return reply.code(404).send({ error: 'not_found' });

      const valid = await bcrypt.compare(current_password, dbUser.password_hash);
      if (!valid) return reply.code(401).send({ error: 'wrong_password', message: 'Current password is incorrect' });

      if (!isStrongPassword(new_password)) {
        return reply.code(400).send({ error: 'weak_password', message: 'Password must be at least 8 characters with uppercase, lowercase, and numbers' });
      }

      const password_hash = await bcrypt.hash(new_password, 12);
      await UserModel.update(user.id, { password_hash });

      return reply.code(200).send({ message: 'Password updated successfully.' });
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
