import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class RecipeIngredientDto {
  @ApiProperty()
  @IsUUID()
  ingredientId: string;

  @ApiPropertyOptional({ example: '2 tsp' })
  @IsOptional()
  @IsString()
  quantity?: string;
}
