import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseBillItemDto {
  @ApiProperty()
  @IsUUID()
  rawMaterialId: string;

  @ApiProperty({
    description:
      "Quantity in the material's own base unit. There is no conversion - a 5kg sack of a GRAM material is 5000.",
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;

  @ApiProperty({ description: 'Price per base unit. 4dp, because a per-gram cost is sub-paisa.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Note there is no `subtotal` or `totalAmount` here: both are computed
 * server-side from the line items. A client-supplied total is how you end up
 * with a bill whose figure disagrees with the sum of its own lines.
 */
export class CreatePurchaseBillDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiProperty({ description: "The vendor's own bill number, from their paper bill." })
  @IsString()
  billNumber: string;

  @ApiProperty()
  @IsDateString()
  billDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ default: 0, description: 'Stays 0 - no tax handling yet (ADR 0013).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ description: 'MediaAsset id of the bill scan. Stored privately.' })
  @IsOptional()
  @IsUUID()
  attachmentMediaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [PurchaseBillItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseBillItemDto)
  items: PurchaseBillItemDto[];
}
