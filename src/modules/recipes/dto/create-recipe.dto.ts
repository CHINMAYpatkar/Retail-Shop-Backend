import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RecipeStepDto } from './recipe-step.dto';
import { RecipeIngredientDto } from './recipe-ingredient.dto';

export class CreateRecipeDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [RecipeStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeStepDto)
  steps: RecipeStepDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  cookingTimeMins?: number;

  @ApiPropertyOptional({ enum: ['Easy', 'Medium', 'Hard'] })
  @IsOptional()
  @IsIn(['Easy', 'Medium', 'Hard'])
  difficulty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [RecipeIngredientDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];

  @ApiPropertyOptional({ type: [String], description: 'Product ids this recipe features' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  productIds?: string[];
}
