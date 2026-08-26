import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryRawMaterialsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Only materials at or below their reorder level.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStockOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ingredientId?: string;
}
