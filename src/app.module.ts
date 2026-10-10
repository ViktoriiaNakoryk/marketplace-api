import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsController } from './products/products.controller';
import { OrdersController } from './orders/orders.controller';
import {validate} from "./config/env.schema";
import {ConfigModule} from "@nestjs/config";
import {DatabaseModule} from "./database/database.module";
import {HealthController} from "./health/health.controller";
import { UsersRepository } from "./users/users.repository";
import { ProductsRepository } from "./products/products.repository";
import { OrdersRepository } from "./orders/orders.repository";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ['.env'],
    }),
    DatabaseModule
  ],
  controllers: [AppController, ProductsController, OrdersController, HealthController],
  providers: [AppService, UsersRepository, ProductsRepository, OrdersRepository],
})
export class AppModule {}
