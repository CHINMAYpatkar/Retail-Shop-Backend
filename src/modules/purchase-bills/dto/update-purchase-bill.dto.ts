import { PartialType } from '@nestjs/swagger';
import { CreatePurchaseBillDto } from './create-purchase-bill.dto';

/**
 * Omitting `items` leaves the existing lines (and therefore stock) untouched.
 * Supplying `items` replaces them all: the old lines' stock effect is reversed
 * and the new lines applied, in one transaction. An empty array is rejected -
 * a bill with no lines is not a bill.
 */
export class UpdatePurchaseBillDto extends PartialType(CreatePurchaseBillDto) {}
