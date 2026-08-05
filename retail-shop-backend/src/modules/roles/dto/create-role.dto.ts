import { ApiProperty } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { ArrayUnique, IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ enum: AdminRoleName })
  @IsEnum(AdminRoleName)
  name: AdminRoleName;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [String], description: 'Permission keys, e.g. products.create' })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys: string[];
}
