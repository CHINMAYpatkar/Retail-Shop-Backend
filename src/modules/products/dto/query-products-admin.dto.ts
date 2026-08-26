import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryProductsAdminDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Include soft-deleted products alongside live ones' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({
    description:
      'Return ONLY soft-deleted products - the trash view. Takes precedence over includeDeleted.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyDeleted?: boolean;
}
