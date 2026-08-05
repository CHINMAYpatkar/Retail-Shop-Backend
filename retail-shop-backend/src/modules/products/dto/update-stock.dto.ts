import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateStockDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  stockQuantity: number;
}
