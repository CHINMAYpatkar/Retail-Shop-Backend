import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('smtp.host'),
      port: this.config.get('smtp.port'),
      secure: this.config.get('smtp.secure'),
      auth: {
        user: this.config.get('smtp.user'),
        pass: this.config.get('smtp.pass'),
      },
    });
  }

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.get('smtp.from'),
        to,
        subject,
        html,
      });
    } catch (error) {
      // Never let a notification failure break the calling request flow.
      this.logger.error(`Failed to send email to ${to}: ${(error as Error).message}`);
    }
  }

  async sendOtpEmail(to: string, code: string, purpose: string): Promise<void> {
    const subject =
      purpose === 'REGISTER'
        ? 'Verify your email - Retail Shop'
        : purpose === 'RESET_PASSWORD'
          ? 'Reset your password - Retail Shop'
          : 'Your login code - Retail Shop';

    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Retail Shop</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
        <p>This code expires shortly and can only be used once. If you did not request this, you can safely ignore this email.</p>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendOrderStatusEmail(to: string, orderNumber: string, status: string): Promise<void> {
    const html = `<p>Your order <b>${orderNumber}</b> status has been updated to <b>${status}</b>.</p>`;
    await this.sendMail(to, `Order Update - ${orderNumber}`, html);
  }
}
