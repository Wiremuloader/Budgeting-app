import { log } from "./log";

/**
 * Outbound email behind a small interface.
 *
 *  - RESEND_API_KEY + EMAIL_FROM set → sent through Resend's HTTP API.
 *  - Otherwise, in development, the message (including any link) is printed to the
 *    server console so verification and password-reset flows can be completed locally.
 *  - Otherwise, in production, sending fails loudly instead of silently dropping mail.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(m: MailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) {
      log.error("mail.send_failed", { status: res.status });
      throw new Error("Email delivery failed");
    }
  }
}

class DevConsoleMailer implements Mailer {
  async send(m: MailMessage) {
    // Development only: the console is the "inbox".
    console.log(`\n──── Ledger dev email ────\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n──────────────────────────\n`);
  }
}

class UnconfiguredMailer implements Mailer {
  async send() {
    log.error("mail.not_configured");
    throw new Error("Email is not configured on this server");
  }
}

let mailer: Mailer | undefined;

export function getMailer(): Mailer {
  if (mailer) return mailer;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (key && from) mailer = new ResendMailer(key, from);
  else if (process.env.NODE_ENV !== "production") mailer = new DevConsoleMailer();
  else mailer = new UnconfiguredMailer();
  return mailer;
}

/** Test hook. */
export function setMailer(m: Mailer | undefined) {
  mailer = m;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
