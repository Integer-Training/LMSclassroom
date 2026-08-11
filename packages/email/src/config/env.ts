import * as z from 'zod';

const envSchema = z.object({
  SMTP_HOST: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SENDER: z.string().optional(),
  // Reply-To identity for outbound mail, e.g. '"Pearl LMS" <support@pearl.example>'.
  // Env-driven so the sender identity carries no hardcoded default domain.
  SMTP_REPLY_TO: z.string().optional(),
  SMTP_USER: z.string().optional(),
  // Dev-only: allow an unauthenticated, non-TLS SMTP relay (e.g. a local
  // Mailpit/MailHog catcher). When 'true', auth creds become optional and
  // STARTTLS is not forced. Leave unset for any real provider.
  SMTP_ALLOW_INSECURE: z.string().optional(),
  ZOHO_TOKEN: z.string().optional()
});

export const env = envSchema.parse(process.env);
