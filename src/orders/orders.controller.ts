import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    NotFoundException,
    Param,
    ParseIntPipe,
    Post,
    Query,
} from '@nestjs/common';
import { PageQueryDto } from '../common/page';
import { CreateOrderDto } from './create-order.dto';
import { OrdersRepository } from './orders.repository';

@Controller('orders')
export class OrdersController {
    constructor(private readonly orders: OrdersRepository) {}

    @Get()
    findAll(@Query() query: PageQueryDto) {
        return this.orders.list(query.limit, query.cursor);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const order = await this.orders.findById(id);
        if (!order) throw new NotFoundException(`Order ${id} not found`);
        return order;
    }

    @Post()
    @HttpCode(201)
    async create(@Body() body: CreateOrderDto, @Headers('idempotency-key') idempotencyKey?: string) {
        if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
        try {
            const order = await this.orders.create(body);
            if (!order) throw new BadRequestException('Order references an unknown product');
            return order;
        } catch (e) {
            if ((e as { code?: string }).code === '23503') {
                throw new BadRequestException(`Buyer ${body.buyerId} does not exist`);
            }
            throw e;
        }
    }
}
