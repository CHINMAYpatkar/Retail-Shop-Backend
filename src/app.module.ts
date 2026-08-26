import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import configuration from './config/configuration';
import { validate } from './config/env.validation';

import { PrismaModule } from './prisma/prisma.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

import { AuthModule } from './modules/auth/auth.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { ProductsModule } from './modules/products/products.module';
import { RecipesModule } from './modules/recipes/recipes.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { BannersModule } from './modules/banners/banners.module';
import { CmsPagesModule } from './modules/cms-pages/cms-pages.module';
import { BlogsModule } from './modules/blogs/blogs.module';
import { FaqsModule } from './modules/faqs/faqs.module';
import { StorageModule } from './modules/storage/storage.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { MediaModule } from './modules/media/media.module';
import { SupportModule } from './modules/support/support.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { RawMaterialsModule } from './modules/raw-materials/raw-materials.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttle.ttl')! * 1000,
          limit: config.get<number>('throttle.limit')!,
        },
      ],
    }),
    PrismaModule,
    StorageModule,
    NotificationsModule,
    AuthModule,
    PermissionsModule,
    RolesModule,
    AdminUsersModule,
    CustomersModule,
    AddressesModule,
    CategoriesModule,
    IngredientsModule,
    ProductsModule,
    RecipesModule,
    WishlistModule,
    CartModule,
    OrdersModule,
    ReviewsModule,
    BannersModule,
    CmsPagesModule,
    BlogsModule,
    FaqsModule,
    UploadsModule,
    MediaModule,
    SupportModule,
    SettingsModule,
    DashboardModule,

    // Back office (procurement). SUPER_ADMIN/ADMIN only.
    VendorsModule,
    RawMaterialsModule,
    // Phase 1 + Phase 2 complete. All modules from the spec are now implemented.
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
