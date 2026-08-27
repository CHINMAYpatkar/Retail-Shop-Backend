import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory, PaymentMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateExpenseDto {
  @ApiProperty({ enum: ExpenseCategory })
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @ApiProperty({ description: 'What it was for, in a few words.' })
  @IsString()
  @MinLength(2)
  title: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiProperty()
  @IsDateString()
  spentOn: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  method: PaymentMode;

  @ApiPropertyOptional({ description: 'Only when paid to a vendor already tracked.' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'MediaAsset id of a receipt. Stored privately.' })
  @IsOptional()
  @IsUUID()
  attachmentMediaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
