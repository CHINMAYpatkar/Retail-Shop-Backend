import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  /**
   * Storage keys returned by `POST /customer/uploads/review-image` - NOT
   * arbitrary URLs. Previously this accepted any string, which let a customer
   * attach an image hosted anywhere (or point at a private key) and have it
   * served from a public product page.
   */
  @ApiPropertyOptional({
    type: [String],
    description: 'storageKey values from POST /customer/uploads/review-image',
    example: ['public/reviews/2026/08/2f1c....webp'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  images?: string[];
}
