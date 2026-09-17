import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { OtpService } from './otp/otp.service';
import { TokensService, TokenPair } from './tokens.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class CustomerAuthService {
  constructor(
    private prisma: PrismaService,
    private otp: OtpService,
    private mail: MailService,
    private tokens: TokensService,
  ) {}

  /**
   * One entry point for signing in and signing up.
   *
   * There is deliberately no separate "register" and "login" here. The system is
   * passwordless, so proving control of an email address IS the authentication -
   * which makes the two the same action, and splitting them served only to leak
   * information.
   *
   * The previous split did exactly that: `login/request-otp` answered 200 for a
   * registered address and 404 for an unknown one, letting anyone enumerate the
   * shop's customer list, while `register` leaked the same fact in reverse.
   *
   * So the response here is identical in every case - registered, unregistered,
   * deactivated, or malformed-but-valid. The caller learns nothing it did not
   * already know. Which branch the customer is on is revealed only AFTER they
   * prove control of the inbox, in `verifyOtp`.
   */
  async requestOtp(dto: RequestOtpDto): Promise<{ message: string }> {
    // Identical for every outcome. Assigned once so no branch can drift from it.
    const generic = {
      message: 'If that email can be used here, we have sent a 6-digit code to it.',
    };

    const existing = await this.prisma.customer.findUnique({ where: { email: dto.email } });

    // A deactivated account gets the same answer and no email. Telling the
    // holder their account is disabled is itself a disclosure, and it is a
    // conversation for support rather than a login screen.
    if (existing && !existing.isActive) return generic;

    const isReturning = Boolean(existing?.emailVerifiedAt);
    const purpose = isReturning ? OtpPurpose.LOGIN : OtpPurpose.REGISTER;

    // An unverified row is created for a first-time address so the OTP has
    // something to hang off. It carries no name, no phone and no orders - it is
    // a placeholder until the code is verified, and is indistinguishable from
    // any other unverified row.
    const customer =
      existing ?? (await this.prisma.customer.create({ data: { email: dto.email } }));

    const code = await this.otp.issueOtp(dto.email, purpose, customer.id);
    await this.mail.sendOtpEmail(dto.email, code, purpose);

    return generic;
  }

  /**
   * Verifies the code and signs the customer in, whichever branch they are on.
   *
   * This is where it becomes safe to say whether the account is new: the caller
   * has just proved they control the inbox, so telling them what is in it
   * discloses nothing they could not already find out.
   *
   * `isNewCustomer` and `profileComplete` are what the storefront routes on -
   * a first-time customer goes to the registration form, a returning one goes
   * straight in. Both are signed in either way: the account exists and the email
   * is verified from this moment, so an abandoned registration form leaves a
   * usable account rather than a dead half-record.
   */
  async verifyOtp(
    dto: VerifyOtpDto,
    meta: RequestMeta = {},
  ): Promise<TokenPair & { isNewCustomer: boolean; profileComplete: boolean }> {
    const existing = await this.prisma.customer.findUnique({ where: { email: dto.email } });

    // Same message the OTP service uses for a bad code, so a nonexistent email
    // and a wrong code are indistinguishable here too.
    if (!existing || !existing.isActive) {
      throw new BadRequestException('That code is invalid or has expired');
    }

    const isNewCustomer = !existing.emailVerifiedAt;
    const purpose = isNewCustomer ? OtpPurpose.REGISTER : OtpPurpose.LOGIN;

    await this.otp.verifyOtp(dto.email, purpose, dto.code);

    const customer = await this.prisma.customer.update({
      where: { id: existing.id },
      data: {
        // Stamped only on first verification, so it records when the address was
        // confirmed rather than when they last signed in.
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        lastLoginAt: new Date(),
      },
    });

    if (meta.userAgent || meta.ipAddress) {
      await this.prisma.customerSession.create({
        data: { customerId: customer.id, userAgent: meta.userAgent, ipAddress: meta.ipAddress },
      });
    }

    const tokens = await this.tokens.issueCustomerTokens(customer.id, customer.email, meta);

    return {
      ...tokens,
      isNewCustomer,
      profileComplete: Boolean(customer.name && customer.phone),
    };
  }

  /**
   * Fills in the details collected after the email is verified.
   *
   * Name and phone live on the account; addresses are managed separately,
   * because a customer can have several and the shop needs to know which one a
   * given order goes to. Payment is cash on delivery, so the phone is the number
   * the shop actually rings - which is why the profile is not "complete" without
   * it, even though the column is nullable.
   */
  async updateProfile(
    customerId: string,
    dto: UpdateCustomerProfileDto,
  ): Promise<ReturnType<CustomerAuthService['getProfile']>> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
      },
    });

    return this.getProfile(customerId);
  }

  async refresh(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    return this.tokens.rotateCustomerTokens(refreshToken, meta);
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    await this.tokens.revokeCustomerRefreshToken(refreshToken);
    return { message: 'Logged out successfully' };
  }

  /**
   * The signed-in customer's own profile.
   *
   * Reading your own identity is unprivileged by definition - a valid customer
   * token is the whole authorisation. This exists because without it the
   * storefront can complete an OTP login, hold a valid token, and still not
   * know who it is signed in as: no name for the header, nothing to prefill at
   * checkout, no account page.
   *
   * That is the same failure the admin side hit, where every non-ADMIN role
   * could authenticate but not load its own profile, and was locked out of the
   * product entirely. See ADR 0001 and the RBAC lockout write-up.
   *
   * `emailVerifiedAt` is collapsed to a boolean: the storefront only ever needs
   * to know whether the address is confirmed, and the timestamp is not its
   * business. `passwordHash` is never selected - auth here is OTP-first and the
   * column is usually null anyway, but selecting it at all is how it ends up in
   * a response by accident later.
   */
  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    // A token can outlive the account it names - deleted between issue and use,
    // or deactivated. 401 rather than 404: the request is authenticated but the
    // credential is no longer good, and the client should re-authenticate
    // rather than treat it as a missing page.
    if (!customer) throw new UnauthorizedException('Account not found');
    if (!customer.isActive) throw new UnauthorizedException('This account has been deactivated');

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      isVerified: customer.emailVerifiedAt !== null,
      // Derived rather than stored, so it can never disagree with the columns
      // it describes. The storefront routes on this: an incomplete profile is
      // sent to the registration form instead of straight into the account.
      profileComplete: Boolean(customer.name && customer.phone),
      lastLoginAt: customer.lastLoginAt,
      createdAt: customer.createdAt,
    };
  }
}
