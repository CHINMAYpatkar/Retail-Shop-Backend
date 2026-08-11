import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const SALT_ROUNDS = 10;

@Injectable()
export class OtpService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  }

  /**
   * Creates and persists a new OTP for the given email + purpose.
   * Enforces a resend cooldown so the same email can't be spammed with codes.
   * Returns the plaintext code so the caller can email it (never stored in plaintext).
   */
  async issueOtp(email: string, purpose: OtpPurpose, customerId?: string): Promise<string> {
    const cooldownSeconds = this.config.get<number>('otp.resendCooldownSeconds')!;
    const lastOtp = await this.prisma.otpCode.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
    });

    if (lastOtp) {
      const secondsSinceLast = (Date.now() - lastOtp.createdAt.getTime()) / 1000;
      if (secondsSinceLast < cooldownSeconds) {
        throw new HttpException(
          `Please wait ${Math.ceil(cooldownSeconds - secondsSinceLast)}s before requesting another code`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
    const expiryMinutes = this.config.get<number>('otp.expiryMinutes')!;
    const maxAttempts = this.config.get<number>('otp.maxAttempts')!;

    await this.prisma.otpCode.create({
      data: {
        email,
        codeHash,
        purpose,
        customerId,
        maxAttempts,
        expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
      },
    });

    return code;
  }

  /**
   * Verifies the most recent unconsumed OTP for email+purpose against the provided code.
   * Throws on mismatch, expiry, or exceeded attempts. Marks OTP consumed on success.
   */
  async verifyOtp(email: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('No active verification code found. Please request a new one.');
    }

    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('This code has expired. Please request a new one.');
    }

    if (otp.attempts >= otp.maxAttempts) {
      throw new BadRequestException('Maximum attempts exceeded. Please request a new code.');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);

    if (!isValid) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }
}
