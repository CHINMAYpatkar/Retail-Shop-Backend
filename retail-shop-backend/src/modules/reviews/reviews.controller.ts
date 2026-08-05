import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private service: ReviewsService) {}

  @Get('products/:productId/reviews')
  findForProduct(@Param('productId') productId: string, @Query() query: QueryReviewsDto) {
    return this.service.findAllForProduct(productId, query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtCustomerAuthGuard)
  @Post('customer/reviews')
  create(@CurrentUser('id') customerId: string, @Body() dto: CreateReviewDto) {
    return this.service.createForCustomer(customerId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtCustomerAuthGuard)
  @Get('customer/reviews')
  findMine(@CurrentUser('id') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }
}
