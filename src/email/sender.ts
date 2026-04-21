import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.ts';

const env = process.env;

export async function sendEmail(
  subject: string,
  html: string,
): Promise<void> {
  const host     = env['EMAIL_SMTP_HOST'] ?? '';
  const port     = parseInt(env['EMAIL_SMTP_PORT'] ?? '587');
  const user     = env['EMAIL_SMTP_USER'] ?? '';
  const password = env['EMAIL_SMTP_PASSWORD'] ?? '';
  const to       = env['EMAIL_RECIPIENT'] ?? '';
  const cc       = env['EMAIL_CC'] || undefined;

  if (!host || !user || !password || !to) {
    logger.warn('Email not configured, skipping send');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass: password },
  });

  await transporter.sendMail({
    from: `"Azul Tracker" <${user}>`,
    to,
    cc,
    subject,
    html,
  });

  logger.info({ to, subject }, 'Email sent');
}
