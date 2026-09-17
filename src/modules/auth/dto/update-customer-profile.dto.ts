import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * The details collected after an email is verified.
 *
 * Both fields are optional so the form can be saved in pieces, but the profile
 * is not treated as complete until both are set - payment is cash on delivery,
 * so the phone is the number the shop actually rings about an order.
 */
export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ example: 'Chinmay Patkar' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional()
  @IsString()
  // Deliberately permissive: digits, spaces, +, -, brackets, 7-20 characters.
  // A strict national format would reject a legitimate number written a way we
  // did not anticipate, and the cost of that is a customer who cannot finish
  // signing up. The number is dialled by a human, not parsed by a machine.
  @Matches(/^[+]?[\d\s()-]{7,20}$/, {
    message: 'Enter a valid contact number',
  })
  phone?: string;
}
