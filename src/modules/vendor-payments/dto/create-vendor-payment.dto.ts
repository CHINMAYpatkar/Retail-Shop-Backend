import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateVendorPaymentDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional({
    description:
      'Bill this payment settles. Omit for an on-account payment (an advance), which reduces the vendor balance without being tied to a bill.',
  })
  @IsOptional()
  @IsUUID()
  purchaseBillId?: string;

  @ApiProperty({ description: 'Must be greater than zero. Use a separate record per payment.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiProperty()
  @IsDateString()
  paidOn: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  method: PaymentMode;

  @ApiPropertyOptional({
    description: 'UPI txn id, cheque number, bank reference - the audit trail.',
  })
  @IsOptional()
  @IsString()
  referenceNo?: string;

  @ApiPropertyOptional({ description: 'MediaAsset id of a receipt scan. Stored privately.' })
  @IsOptional()
  @IsUUID()
  attachmentMediaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
