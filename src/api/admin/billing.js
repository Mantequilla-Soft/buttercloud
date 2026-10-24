import { requireAdmin } from '../../middleware/adminAuth.js';
import { BillingRecordModel } from '../../db/models/BillingRecord.js';
import { UserModel } from '../../db/models/User.js';
import { generateMonthlyInvoices, generateInvoiceForUser, previousMonth, currentMonth, compInvoice } from '../../services/billing.js';
import { sendInvoiceEmail } from '../../services/email.js';
import { config } from '../../config.js';

export async function registerAdminBillingRoutes(fastify) {
  // GET /api/v1/admin/billing — list all invoices across all users
  fastify.get('/api/v1/admin/billing', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { status, limit = 50, offset = 0 } = request.query;
      const result = await BillingRecordModel.listByStatus(status || 'draft', parseInt(limit), parseInt(offset));

      // Enrich with user email
      const enriched = await Promise.all(result.items.map(async inv => {
        const user = await UserModel.findById(inv.user_id.toString());
        return {
          id: inv._id.toString(),
          user_id: inv.user_id.toString(),
          user_email: user?.email || 'unknown',
          user_plan: user?.plan || 'unknown',
          month: inv.month.toISOString().substring(0, 7),
          base_fee_usd: inv.base_fee,
          storage_charge_usd: inv.storage_charge,
          transfer_charge_usd: inv.transfer_charge,
          subtotal_usd: inv.subtotal,
          tax_usd: inv.tax,
          credit_usd: inv.credit_cents || 0,
          total_usd: inv.total,
          status: inv.status,
          due_date: inv.due_date.toISOString(),
          created_at: inv.created_at.toISOString(),
        };
      }));

      return reply.code(200).send({ invoices: enriched, total: result.total });
    } catch (error) {
      return reply.code(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // POST /api/v1/admin/billing/generate — generate invoices for a month
  fastify.post('/api/v1/admin/billing/generate', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      // Default: generate for previous month (the completed billing period)
      const month = request.body?.month || previousMonth();
      const results = await generateMonthlyInvoices(month);

      const created  = results.filter(r => !r.skipped && !r.error).length;
      const skipped  = results.filter(r => r.skipped).length;
      const errors   = results.filter(r => r.error).length;

      return reply.code(200).send({ month, created, skipped, errors, results });
    } catch (error) {
      return reply.code(500).send({ error: 'generation_failed', message: error.message });
    }
  });

  // PATCH /api/v1/admin/billing/:invoiceId — update status (mark paid, finalize, etc.)
  fastify.patch('/api/v1/admin/billing/:invoiceId', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { invoiceId } = request.params;
      const { status } = request.body;

      if (!['draft', 'pending', 'paid', 'overdue', 'cancelled'].includes(status)) {
        return reply.code(400).send({ error: 'invalid_status' });
      }

      const update = { status };
      if (status === 'paid') update.payment_received_at = new Date();

      await BillingRecordModel.update(invoiceId, update);

      // Send invoice email when transitioning to pending ("Send" button)
      if (status === 'pending') {
        try {
          const inv = await BillingRecordModel.findById(invoiceId);
          const user = await UserModel.findById(inv.user_id.toString());
          if (user?.email) {
            await sendInvoiceEmail({
              to: user.email,
              hiveAccount: config.hive.account || null,
              invoice: {
                id: invoiceId,
                month: inv.month.toISOString().substring(0, 7),
                base_fee_usd: inv.base_fee,
                storage_charge_usd: inv.storage_charge,
                transfer_charge_usd: inv.transfer_charge,
                total_usd: inv.total,
                due_date: inv.due_date.toISOString(),
              },
            });
          }
        } catch (emailErr) {
          // Email failure is non-fatal — invoice is already updated
          console.warn('Invoice email failed:', emailErr.message);
        }
      }

      return reply.code(200).send({ id: invoiceId, status });
    } catch (error) {
      return reply.code(500).send({ error: 'update_failed', message: error.message });
    }
  });

  // POST /api/v1/admin/billing/:invoiceId/comp — waive an invoice immediately.
  // Issues a credit for exactly what's left owed and marks the invoice 'comped'
  // (not 'paid') so revenue reporting can tell the two apart.
  fastify.post('/api/v1/admin/billing/:invoiceId/comp', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { invoiceId } = request.params;
      const { reason } = request.body || {};

      const result = await compInvoice(invoiceId, request.user.id, reason);

      return reply.code(200).send({
        id: invoiceId,
        status: 'comped',
        comped_amount_cents: result.comped_amount_cents,
      });
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: error.statusCode === 404 ? 'not_found' : error.statusCode === 400 ? 'invalid_request' : 'comp_failed',
        message: error.message,
      });
    }
  });
}
