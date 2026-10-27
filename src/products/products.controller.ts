import { Controller, Get, Inject, NotFoundException, Optional, Param, ParseIntPipe, Query } from '@nestjs/common';
import type Redis from 'ioredis';
import { PageQueryDto } from '../common/page';
import { CACHE_REDIS } from '../redis/redis.module';
import { ProductCardCache } from './product-card.cache';
import { ProductsRepository } from './products.repository';

@Controller('products')
export class ProductsController {
    private readonly cards: ProductCardCache | null;

    constructor(
        private readonly products: ProductsRepository,
        @Optional() @Inject(CACHE_REDIS) redis: Redis | null,
    ) {
        this.cards = redis ? new ProductCardCache(redis, (id) => products.findCard(id)) : null;
    }

    @Get()
    findAll(@Query() query: PageQueryDto) {
        return this.products.list(query.limit, query.cursor);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const product = await this.products.findById(id);
        if (!product) throw new NotFoundException(`Product ${id} not found`);
        return product;
    }

    @Get(':id/card')
    async card(@Param('id', ParseIntPipe) id: number) {
        const card = this.cards ? await this.cards.get(id) : await this.products.findCard(id);
        if (!card) throw new NotFoundException(`Product ${id} not found`);
        return card;
    }
}
