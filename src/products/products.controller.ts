import { Controller, Get } from '@nestjs/common';

@Controller('products')
export class ProductsController {
    @Get()
    findAll() {
        return { items: [], next_cursor: null };
    }

}