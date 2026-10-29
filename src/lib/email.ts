import * as Sentry from "@sentry/nextjs";

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Sends a transactional email through Resend's HTTP API. Without
 * RESEND_API_KEY (tests, local work without an account) the email is logged
 * instead. Outside production a failed send also logs the text, so links in
 * it (verification, invites) can still be followed during development.
 */
export async function sendEmail(email: Email): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "wepunch <onboarding@resend.dev>";

  if (!apiKey) {
    logEmail("RESEND_API_KEY not set; email not sent", email);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    return true;
  } catch (err) {
    Sentry.captureException(err, { tags: { email: email.subject } });
    if (process.env.NODE_ENV !== "production") logEmail("email send failed", email);
    else console.error("email send failed:", (err as Error).message);
    return false;
  }
}

function logEmail(reason: string, email: Email) {
  console.info(`[email] ${reason}\n  to: ${email.to}\n  subject: ${email.subject}\n\n${email.text}\n`);
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One-button email in the plain style every wepunch email shares. */
export function actionEmail(opts: { to: string; subject: string; intro: string; action: string; url: string }): Email {
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#18181b;max-width:480px;margin:0 auto;padding:24px">
<p style="font-size:18px;font-weight:600">wepunch</p>
<p>${escape(opts.intro)}</p>
<p><a href="${escape(opts.url)}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${escape(opts.action)}</a></p>
<p style="color:#71717a;font-size:13px">Or paste this link into your browser:<br>${escape(opts.url)}</p>
</body></html>`;
  const text = `${opts.intro}\n\n${opts.action}: ${opts.url}\n`;
  return { to: opts.to, subject: opts.subject, html, text };
}
