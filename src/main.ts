import './config/validate-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {ConfigService} from "@nestjs/config";
import {Env} from "./config/env.schema";
import { configureApp } from './app.setup';
import type Redis from 'ioredis';
import { STATE_REDIS } from './redis/redis.module';
import { rateLimitMiddleware, SlidingWindowLimiter } from './rate-limit/sliding-window.limiter';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  const state = app.get<Redis | null>(STATE_REDIS);
  if (state) app.use(rateLimitMiddleware(new SlidingWindowLimiter(state, config.get('RATE_LIMIT_PER_MINUTE', { infer: true }), 60_000)));
  await app.listen(port);
}
bootstrap();
