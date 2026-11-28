import type { Env } from '../env';
import { fail } from './util';

export interface EmailMessage {
  subject: string;
  title: string;
  intro: string;
  code?: string;
  detail?: string;
  warning?: string;
}

const escapeHTML = (value: string) => value.replace(/[&<>\"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
})[character]!);

export function renderEmail(message: EmailMessage): { html: string; text: string } {
  const title = escapeHTML(message.title);
  const intro = escapeHTML(message.intro);
  const detail = message.detail ? escapeHTML(message.detail) : '';
  const warning = message.warning ? escapeHTML(message.warning) : '';
  const code = message.code ? escapeHTML(message.code) : '';
  const text = [message.title, message.intro, message.code ? `Code: ${message.code}` : '', message.detail ?? '',
    message.warning ?? '', 'KOLABA'].filter(Boolean).join('\n\n');

  return {
    text,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#100b18;color:#f8f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${intro}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#100b18;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#1c1427;border:1px solid #39294b;border-radius:24px;overflow:hidden">
        <tr><td style="height:8px;background:linear-gradient(90deg,#ff4fa3,#a86cff,#54d7ff)"></td></tr>
        <tr><td style="padding:34px 32px 12px;text-align:center">
          <div style="font-size:26px;font-weight:800;letter-spacing:.08em">KOLABA</div>
        </td></tr>
        <tr><td style="padding:12px 32px 36px">
          <h1 style="margin:0 0 16px;text-align:center;font-size:25px;line-height:1.25">${title}</h1>
          <p style="margin:0;color:#d7cde2;text-align:center;font-size:16px;line-height:1.6">${intro}</p>
          ${code ? `<div style="margin:28px auto;padding:18px 12px;max-width:320px;border-radius:16px;background:#281c37;text-align:center;font-size:34px;font-weight:800;letter-spacing:.24em;color:#ff73b8">${code}</div>` : ''}
          ${detail ? `<p style="margin:20px 0 0;color:#b9abc8;text-align:center;font-size:14px;line-height:1.6">${detail}</p>` : ''}
          ${warning ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #39294b;color:#8f819e;text-align:center;font-size:13px;line-height:1.55">${warning}</p>` : ''}
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#756881;font-size:12px">© KOLABA</p>
    </td></tr>
  </table>
</body></html>`,
  };
}

/** Whether any way of delivering e-mail is configured (Cloudflare Email Sending, or Resend). */
export const canSendEmail = (env: Env) => Boolean(env.SEND_EMAIL || env.RESEND_API_KEY);

/** `KOLABA <verify@kolaba.app>` → its parts. */
function sender(from: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1] || 'KOLABA', email: match[2] } : { name: 'KOLABA', email: from.trim() };
}

export async function sendEmail(env: Env, to: string, message: EmailMessage): Promise<void> {
  if (!canSendEmail(env)) fail(503, 'email_unavailable', 'E-mail delivery is not configured yet.');
  const { html, text } = renderEmail(message);
  if (env.SEND_EMAIL) {
    try {
      await env.SEND_EMAIL.send({ from: sender(env.EMAIL_FROM), to, subject: message.subject, html, text });
      return;
    } catch (error) {
      // Never log the recipient or the code: the error's name is enough for operations.
      console.error('email sending failed', { error: error instanceof Error ? error.name : 'unknown' });
      if (!env.RESEND_API_KEY) fail(503, 'email_failed');
    }
  }
  const response = await fetch(env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: message.subject, html, text }),
  });
  if (!response.ok) {
    // Status and provider request id are enough for operations; the response body may contain recipient data.
    console.error('resend failed', { status: response.status, requestId: response.headers.get('x-request-id') ?? undefined });
    fail(503, 'email_failed');
  }
}
