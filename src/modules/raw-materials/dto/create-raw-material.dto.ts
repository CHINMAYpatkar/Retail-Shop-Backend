import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeasurementUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRawMaterialDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({ description: 'Your own reference code. Must be unique if given.' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({
    enum: MeasurementUnit,
    description:
      'The ONE unit this material is always measured in - purchases, stock and consumption alike. ' +
      'There is no unit conversion: buy a 5kg sack of a GRAM material as quantity 5000.',
  })
  @IsEnum(MeasurementUnit)
  baseUnit: MeasurementUnit;

  @ApiPropertyOptional({ description: 'Opening stock. Purchases add to this.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ description: 'Flag the material as low when stock falls below this.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  reorderLevel?: number;

  @ApiPropertyOptional({
    description:
      'Opening cost per base unit. Normally maintained automatically as a moving average when bills are recorded.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  avgCostPerUnit?: number;

  @ApiPropertyOptional({ description: 'Optional link to the storefront-facing Ingredient.' })
  @IsOptional()
  @IsUUID()
  ingredientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
