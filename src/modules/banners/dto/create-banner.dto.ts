import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BannerPlacement } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateBannerDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiProperty({ description: 'Required. Doubles as the poster frame when videoUrl is set.' })
  @IsString()
  imageUrl: string;

  @ApiPropertyOptional({ description: 'Optional promo/advertisement video.' })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ctaLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ctaUrl?: string;

  @ApiProperty({ enum: BannerPlacement })
  @IsEnum(BannerPlacement)
  placement: BannerPlacement;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
