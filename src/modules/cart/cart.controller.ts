import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('Cart')
@ApiBearerAuth()
@UseGuards(JwtCustomerAuthGuard)
@Controller('customer/cart')
export class CartController {
  constructor(private service: CartService) {}

  @Get()
  getCart(@CurrentUser('id') customerId: string) {
    return this.service.getCart(customerId);
  }

  @Post()
  addItem(@CurrentUser('id') customerId: string, @Body() dto: AddCartItemDto) {
    return this.service.addItem(customerId, dto);
  }

  @Patch(':itemId')
  updateItem(
    @CurrentUser('id') customerId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.service.updateItem(customerId, itemId, dto.quantity);
  }

  @Delete(':itemId')
  removeItem(@CurrentUser('id') customerId: string, @Param('itemId') itemId: string) {
    return this.service.removeItem(customerId, itemId);
  }

  @Delete()
  clear(@CurrentUser('id') customerId: string) {
    return this.service.clear(customerId);
  }
}
