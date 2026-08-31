import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Inclusive. Omit for all time.' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Inclusive. Omit for all time.' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
