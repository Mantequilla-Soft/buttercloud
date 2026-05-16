import nodemailer from 'nodemailer';
import { config } from '../config.js';

function createTransport() {
  if (!config.smtp.host) return null;
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
}

// Lazy singleton — only created if SMTP is configured
let _transport = null;
function transport() {
  if (!_transport) _transport = createTransport();
  return _transport;
}

function cents(v) {
  return `$${(v / 100).toFixed(2)}`;
}

function invoiceEmailHtml({ invoice, hiveAccount }) {
  const memo = `BC-${invoice.id}`;
  const hbdAmount = (invoice.total_usd / 100).toFixed(3);
  const due = new Date(invoice.due_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const hiveBlock = hiveAccount ? `
    <div style="margin-top:24px;padding:16px;background:#1e1a14;border:1px solid #3a3020;border-radius:8px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#d4a827;">How to pay</p>
      <table style="font-size:13px;color:#c8b97a;border-collapse:collapse;width:100%;">
        <tr>
          <td style="padding:3px 0;color:#7a6e5a;width:80px;">Network</td>
          <td style="padding:3px 0;">HIVE blockchain</td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#7a6e5a;">Account</td>
          <td style="padding:3px 0;font-family:monospace;">@${hiveAccount}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#7a6e5a;">Amount</td>
          <td style="padding:3px 0;font-family:monospace;">${hbdAmount} HBD <span style="color:#7a6e5a;">(or equivalent HIVE)</span></td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#7a6e5a;">Memo</td>
          <td style="padding:3px 0;font-family:monospace;color:#d4a827;">${memo}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0;font-size:11px;color:#7a6e5a;">Include the exact memo — it identifies your payment automatically.</p>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0d0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    <!-- Header -->
    <div style="margin-bottom:32px;">
      <span style="font-size:18px;font-weight:700;color:#e8dcc8;">Butter</span><span style="font-size:18px;font-weight:700;color:#d4a827;">Cloud</span>
    </div>

    <!-- Invoice card -->
    <div style="background:#16130e;border:1px solid #2a2418;border-radius:12px;padding:28px;">

      <p style="margin:0 0 4px;font-size:12px;color:#7a6e5a;text-transform:uppercase;letter-spacing:0.06em;">Invoice</p>
      <h1 style="margin:0 0 24px;font-size:22px;font-weight:600;color:#e8dcc8;">${invoice.month}</h1>

      <!-- Line items -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #2a2418;">
          <td style="padding:10px 0;color:#a89880;">Base plan</td>
          <td style="padding:10px 0;text-align:right;color:#e8dcc8;font-family:monospace;">${cents(invoice.base_fee_usd)}</td>
        </tr>
        ${invoice.storage_charge_usd > 0 ? `
        <tr style="border-bottom:1px solid #2a2418;">
          <td style="padding:10px 0;color:#a89880;">Storage overage</td>
          <td style="padding:10px 0;text-align:right;color:#e8dcc8;font-family:monospace;">${cents(invoice.storage_charge_usd)}</td>
        </tr>` : ''}
        ${invoice.transfer_charge_usd > 0 ? `
        <tr style="border-bottom:1px solid #2a2418;">
          <td style="padding:10px 0;color:#a89880;">Transfer overage</td>
          <td style="padding:10px 0;text-align:right;color:#e8dcc8;font-family:monospace;">${cents(invoice.transfer_charge_usd)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:14px 0 0;font-size:15px;font-weight:600;color:#e8dcc8;">Total due</td>
          <td style="padding:14px 0 0;text-align:right;font-size:15px;font-weight:700;color:#d4a827;font-family:monospace;">${cents(invoice.total_usd)}</td>
        </tr>
      </table>

      <p style="margin:16px 0 0;font-size:12px;color:#7a6e5a;">Due by ${due}</p>

      ${hiveBlock}
    </div>

    <!-- Footer -->
    <p style="margin:24px 0 0;font-size:11px;color:#4a4030;text-align:center;">
      ButterCloud · You're receiving this because you have an active account.
    </p>
  </div>
</body>
</html>`;
}

export async function sendVerificationEmail({ to, verifyUrl }) {
  const t = transport();
  if (!t) {
    console.warn('Email not configured — skipping verification email to', to);
    return { skipped: true };
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0d0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;padding:0 20px;">
    <div style="margin-bottom:28px;">
      <span style="font-size:18px;font-weight:700;color:#e8dcc8;">Butter</span><span style="font-size:18px;font-weight:700;color:#d4a827;">Cloud</span>
    </div>
    <div style="background:#16130e;border:1px solid #2a2418;border-radius:12px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#e8dcc8;">Verify your email</h1>
      <p style="margin:0 0 24px;font-size:14px;color:#a89880;line-height:1.6;">
        Click the button below to verify your email address and activate your ButterCloud account.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#d4a827;color:#0f0d0a;font-weight:600;font-size:14px;border-radius:8px;text-decoration:none;">
        Verify Email
      </a>
      <p style="margin:20px 0 0;font-size:12px;color:#7a6e5a;">
        Link expires in 24 hours. If you didn't create an account, you can ignore this email.
      </p>
    </div>
    <p style="margin:20px 0 0;font-size:11px;color:#4a4030;text-align:center;">ButterCloud</p>
  </div>
</body>
</html>`;

  await t.sendMail({
    from: `"ButterCloud" <${config.smtp.from}>`,
    to,
    subject: 'Verify your ButterCloud email',
    html,
  });

  return { sent: true };
}

export async function sendInvoiceEmail({ to, invoice, hiveAccount }) {
  const t = transport();
  if (!t) {
    console.warn('Email not configured — skipping invoice email to', to);
    return { skipped: true };
  }

  await t.sendMail({
    from: `"ButterCloud Billing" <${config.smtp.from}>`,
    to,
    subject: `Invoice for ${invoice.month} — ${(invoice.total_usd / 100).toFixed(2)} due`,
    html: invoiceEmailHtml({ invoice, hiveAccount }),
  });

  return { sent: true };
}
