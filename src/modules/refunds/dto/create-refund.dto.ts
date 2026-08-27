import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMode, RefundStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateRefundDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'Why the refund was given. Required - refunds need a reason on record.',
  })
  @IsString()
  @MinLength(3)
  reason: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  method: PaymentMode;

  @ApiPropertyOptional({
    enum: RefundStatus,
    default: 'PENDING',
    description:
      'PENDING when agreed but not yet sent; COMPLETED once the money has actually left. The gap between them is a real liability.',
  })
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

  @ApiPropertyOptional({ description: 'UPI transaction id or bank reference - the audit trail.' })
  @IsOptional()
  @IsString()
  referenceNo?: string;

  @ApiPropertyOptional({
    description: 'When the money actually went. Defaults to now if status is COMPLETED.',
  })
  @IsOptional()
  @IsDateString()
  refundedOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
