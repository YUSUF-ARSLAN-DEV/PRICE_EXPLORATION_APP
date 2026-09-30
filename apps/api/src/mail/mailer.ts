import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { CONFIG, Config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export abstract class Mailer {
  abstract send(mail: Mail): Promise<void>;
}

/** SMTP (Mailpit locally; an approved in-region relay in production - see subprocessors.md). */
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly log = new Logger('mail');
  private readonly transport;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    super();
    this.transport = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: false,
      ignoreTLS: cfg.env !== 'production',
    });
  }

  async send(mail: Mail): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.cfg.smtp.from, ...mail });
    } catch (err) {
      // Never log recipient addresses or content (PII).
      this.log.error(`mail delivery failed: ${(err as Error).message}`);
      throw err;
    }
  }
}

/** Test double that records messages. */
@Injectable()
export class MemoryMailer extends Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
  last(to?: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => !to || m.to === to);
  }
  tokenFrom(to: string): string {
    const m = /token=([A-Za-z0-9_-]{20,})/.exec(this.last(to)?.text ?? '');
    if (!m) throw new Error(`no token mail for ${to}`);
    return m[1]!;
  }
}
