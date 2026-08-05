import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WishlistService } from './wishlist.service';

@ApiTags('Wishlist')
@ApiBearerAuth()
@UseGuards(JwtCustomerAuthGuard)
@Controller('customer/wishlist')
export class WishlistController {
  constructor(private service: WishlistService) {}

  @Get()
  findAll(@CurrentUser('id') customerId: string) {
    return this.service.findAll(customerId);
  }

  @Post(':productId')
  add(@CurrentUser('id') customerId: string, @Param('productId') productId: string) {
    return this.service.add(customerId, productId);
  }

  @Delete(':productId')
  remove(@CurrentUser('id') customerId: string, @Param('productId') productId: string) {
    return this.service.remove(customerId, productId);
  }
}
