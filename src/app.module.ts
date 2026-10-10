import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsController } from './products/products.controller';
import { OrdersController } from './orders/orders.controller';
import {validate} from "./config/env.schema";
import {ConfigModule} from "@nestjs/config";
import {DatabaseModule} from "./database/database.module";
import {HealthController} from "./health/health.controller";
import { MessagingModule } from "./messaging/messaging.module";
import { UsersRepository } from "./users/users.repository";
import { ProductsRepository } from "./products/products.repository";
import { OrdersRepository } from "./orders/orders.repository";
import { OrdersService } from "./orders/orders.service";
import { OrderEventsService } from "./orders/order-events.service";
import { OrdersGateway } from "./orders/orders.gateway";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ['.env'],
    }),
    DatabaseModule,
    MessagingModule,
  ],
  controllers: [AppController, ProductsController, OrdersController, HealthController],
  providers: [
    AppService,
    UsersRepository,
    ProductsRepository,
    OrdersRepository,
    OrderEventsService,
    OrdersService,
    OrdersGateway,
  ],
})
export class AppModule {}
