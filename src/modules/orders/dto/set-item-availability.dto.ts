import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Marking one line of an order unavailable, or available again.
 *
 * `available: false` is the interesting direction. It requires a date, because
 * telling a customer "we don't have it" without saying when is worse than
 * saying nothing - and because the whole point of this feature is that the
 * order is NOT cancelled, which only reassures if there is a date attached.
 */
export class SetItemAvailabilityDto {
  @ApiProperty({
    description: 'false marks the line out of stock; true clears the hold.',
  })
  @IsBoolean()
  available!: boolean;

  @ApiPropertyOptional({
    description: 'When the shop expects this line back. Required when marking unavailable.',
    example: '2026-11-01T00:00:00.000Z',
  })
  @ValidateIf((dto: SetItemAvailabilityDto) => dto.available === false)
  @IsDateString(
    {},
    { message: 'Give an expected availability date when marking a line unavailable' },
  )
  expectedAvailabilityDate?: string;

  @ApiPropertyOptional({
    description: 'Shown to the customer alongside the date, so write it in their language.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  availabilityNote?: string;

  @ApiPropertyOptional({
    description:
      'true holds the whole order until this line arrives; false ships what is available now and sends the rest on later. Ignored when clearing a hold.',
    default: false,
  })
  @ValidateIf((dto: SetItemAvailabilityDto) => dto.available === false)
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  holdForStock?: boolean;
}
