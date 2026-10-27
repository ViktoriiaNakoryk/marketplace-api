import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Optional, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import type Redis from 'ioredis';
import { PageQueryDto } from '../common/page';
import { CACHE_REDIS } from '../redis/redis.module';
import { ProductCardCache } from './product-card.cache';
import { CreateProductDto } from './create-product.dto';
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

    @Post()
    @HttpCode(201)
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('seller', 'admin')
    create(@Body() body: CreateProductDto, @CurrentUser() user: AccessClaims) {
        return this.products.create({ ...body, sellerId: user.sub });
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
