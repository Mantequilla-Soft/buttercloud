#!/usr/bin/env node
// Quick SMTP connectivity test — reads config from .env
// Usage: node scripts/test-email.js your@email.com

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

// Parse .env manually — bypasses dotenvx interception issues
const envPath = resolve(fileURLToPath(import.meta.url), '../../.env');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch (e) {
  console.warn('Could not read .env:', e.message);
}

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/test-email.js <recipient@email.com>');
  process.exit(1);
}

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

console.log('\nSMTP config loaded from .env:');
console.log(`  Host : ${SMTP_HOST || '(not set)'}`);
console.log(`  Port : ${SMTP_PORT || '(not set)'}`);
console.log(`  User : ${SMTP_USER || '(not set)'}`);
console.log(`  Pass : ${SMTP_PASS ? SMTP_PASS.slice(0, 6) + '…' : '(not set)'}`);
console.log(`  From : ${SMTP_FROM || '(not set)'}`);
console.log(`  To   : ${to}`);

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('\n✖ SMTP is not configured in .env — set SMTP_HOST, SMTP_USER, SMTP_PASS');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: parseInt(SMTP_PORT || '465'),
  secure: parseInt(SMTP_PORT || '465') === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

console.log('\nVerifying connection…');
try {
  await transporter.verify();
  console.log('✔ SMTP connection OK');
} catch (err) {
  console.error('✖ Connection failed:', err.message);
  process.exit(1);
}

console.log('Sending test email…');
try {
  const info = await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: 'Buttercloud — SMTP test',
    html: '<p>If you received this, your SMTP config is working correctly.</p>',
  });
  console.log('✔ Email sent!  Message ID:', info.messageId);
} catch (err) {
  console.error('✖ Send failed:', err.message);
  process.exit(1);
}
