import { PartialType } from '@nestjs/swagger';
import { CreateRawMaterialDto } from './create-raw-material.dto';

/**
 * `baseUnit` is intentionally still changeable, but doing so on a material that
 * already holds stock is meaningless - the existing quantity was recorded in the
 * old unit. The service refuses in that case rather than silently reinterpreting
 * the number.
 */
export class UpdateRawMaterialDto extends PartialType(CreateRawMaterialDto) {}
