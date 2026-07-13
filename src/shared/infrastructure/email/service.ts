import nodemailer from "nodemailer";
import type { Email, EmailService } from "@/shared/domain/email";
import type { SmtpConfig } from "./config";

export class SmtpEmailService implements EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.port === 465,
        auth: {
          user: this.config.user,
          pass: this.config.pass,
        },
      });
    }
    return this.transporter;
  }

  async send(email: Email): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.config.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
    });
  }
}
