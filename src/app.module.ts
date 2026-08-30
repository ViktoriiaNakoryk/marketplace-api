import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsController } from './products/products.controller';
import { OrdersController } from './orders/orders.controller';

@Module({
  imports: [],
  controllers: [AppController, ProductsController, OrdersController],
  providers: [AppService],
})
export class AppModule {}
