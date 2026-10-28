import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Wraps every outgoing email in a consistent, lightly-branded shell so
 * OTP codes, order updates, and ticket replies all look like they come
 * from the same product instead of ad-hoc inline HTML per call site.
 */
function renderEmailShell(bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1C1A17;">
      <div style="padding: 24px 0 16px; border-bottom: 2px solid #B8791C;">
        <span style="font-size: 18px; font-weight: 700;">Retail Shop</span>
      </div>
      <div style="padding: 24px 0;">
        ${bodyHtml}
      </div>
      <div style="padding: 16px 0; border-top: 1px solid #E8E3DA; font-size: 12px; color: #6B655C;">
        This is an automated message from Retail Shop. Please do not reply directly to this email.
      </div>
    </div>
  `;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private isConfigured = false;

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

  /**
   * Verifies SMTP credentials once at boot so a misconfigured provider is a
   * loud, obvious log line on startup - not a mystery discovered days later
   * when a customer says "I never got my OTP".
   */
  async onModuleInit() {
    try {
      await this.transporter.verify();
      this.isConfigured = true;
      this.logger.log(`SMTP connected (${this.config.get('smtp.host')}) - outgoing email is live`);
    } catch (error) {
      this.isConfigured = false;
      this.logger.warn(
        `SMTP verification failed - emails will NOT be delivered until this is fixed. ` +
          `Reason: ${(error as Error).message}`,
      );
    }
  }

  async sendMail(
    to: string,
    subject: string,
    bodyHtml: string,
  ): Promise<{ success: boolean; error?: string }> {
    const html = renderEmailShell(bodyHtml);
    const attempt = async () =>
      this.transporter.sendMail({ from: this.config.get('smtp.from'), to, subject, html });

    try {
      await attempt();
      return { success: true };
    } catch (firstError) {
      this.logger.warn(
        `Email send failed (attempt 1/2) to ${to}: ${(firstError as Error).message}`,
      );
      try {
        await attempt();
        return { success: true };
      } catch (secondError) {
        const message = (secondError as Error).message;
        this.logger.error(`Email send failed (attempt 2/2) to ${to}: ${message}`);
        return { success: false, error: message };
      }
    }
  }

  async sendOtpEmail(to: string, code: string, purpose: string): Promise<void> {
    const subject =
      purpose === 'REGISTER'
        ? 'Verify your email - Retail Shop'
        : purpose === 'RESET_PASSWORD'
          ? 'Reset your password - Retail Shop'
          : 'Your login code - Retail Shop';

    const body = `
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>This code expires shortly and can only be used once. If you did not request this, you can safely ignore this email.</p>
    `;
    await this.sendMail(to, subject, body);
  }

  async sendOrderStatusEmail(to: string, orderNumber: string, status: string): Promise<void> {
    const body = `<p>Your order <b>${orderNumber}</b> status has been updated to <b>${status}</b>.</p>`;
    await this.sendMail(to, `Order Update - ${orderNumber}`, body);
  }

  /**
   * One line of an order is out of stock.
   *
   * The tone matters more than usual here. This email arrives unprompted and
   * carries bad news, so it leads with what is NOT happening - the order is
   * not cancelled, nothing is being refunded, no action is needed - before the
   * date. A customer who reads only the first sentence should still be calm.
   */
  async sendItemUnavailableEmail(
    to: string,
    details: {
      orderNumber: string;
      productName: string;
      expectedDate: Date;
      note?: string;
      holdingWholeOrder: boolean;
    },
  ): Promise<void> {
    const when = details.expectedDate.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    const plan = details.holdingWholeOrder
      ? `<p>We are holding your order together, so everything will arrive in one delivery once <b>${details.productName}</b> is ready.</p>`
      : `<p>The rest of your order is on its way as planned. <b>${details.productName}</b> will follow in a second delivery as soon as it is ready, at no extra charge.</p>`;

    const body = `
      <p>Your order <b>${details.orderNumber}</b> is still on its way - nothing has been cancelled and there is nothing you need to do.</p>
      <p>One item is taking a little longer than usual:</p>
      <p style="margin: 16px 0; padding: 12px 16px; background: #f6f3ee; border-left: 3px solid #c8a24a;">
        <b>${details.productName}</b><br />
        Expected to be ready by <b>${when}</b>
      </p>
      ${details.note ? `<p>${details.note}</p>` : ''}
      ${plan}
      <p>We make everything in small batches, which is why this happens occasionally. Thank you for your patience.</p>
    `;

    await this.sendMail(to, `A small delay on order ${details.orderNumber}`, body);
  }

  /** The follow-up: the held line is back, and the order is moving again. */
  async sendItemBackInStockEmail(
    to: string,
    orderNumber: string,
    productName: string,
  ): Promise<void> {
    const body = `
      <p>Good news - <b>${productName}</b> is ready, and your order <b>${orderNumber}</b> is moving again.</p>
      <p>We will let you know as soon as it is on its way.</p>
    `;
    await this.sendMail(to, `${productName} is back - order ${orderNumber}`, body);
  }

  /** Used by the admin "send test email" endpoint to self-verify SMTP end-to-end. */
  async sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
    const body = `<p>This is a test email from your Retail Shop admin console, sent at ${new Date().toISOString()}.</p><p>If you're reading this, your SMTP configuration works.</p>`;
    return this.sendMail(to, 'Test email - Retail Shop', body);
  }

  getStatus(): { configured: boolean; host?: string; from?: string } {
    return {
      configured: this.isConfigured,
      host: this.config.get('smtp.host'),
      from: this.config.get('smtp.from'),
    };
  }
}
