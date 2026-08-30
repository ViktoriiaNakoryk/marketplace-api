import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
    @Get()
    findAll() {
        return { items: [], next_cursor: null };
    }

    @Post()
    @HttpCode(201)
    create(@Body() body: { items: unknown }) {
        return { id: 1, items: body.items };
    }
}