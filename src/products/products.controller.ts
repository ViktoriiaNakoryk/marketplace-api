import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PageQueryDto } from '../common/page';
import { ProductsRepository } from './products.repository';

@Controller('products')
export class ProductsController {
    constructor(private readonly products: ProductsRepository) {}

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
}
