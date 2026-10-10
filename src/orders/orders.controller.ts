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
    Patch,
    Post,
    Query,
    Req,
    Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PageQueryDto } from '../common/page';
import { ChangeStatusDto } from './change-status.dto';
import { CreateOrderDto } from './create-order.dto';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

const HEARTBEAT_MS = 15_000;

function toSseFrame(event: OrderStatusEvent): string {
    return `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseLastEventId(raw: string | undefined): number | undefined {
    const n = Number(raw);
    return raw !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
}

@Controller('orders')
export class OrdersController {
    constructor(
        private readonly orders: OrdersRepository,
        private readonly ordersService: OrdersService,
        private readonly events: OrderEventsService,
    ) {}

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
            const order = await this.ordersService.placeOrder(body);
            if (!order) throw new BadRequestException('Order references an unknown product');
            return order;
        } catch (e) {
            if ((e as { code?: string }).code === '23503') {
                throw new BadRequestException(`Buyer ${body.buyerId} does not exist`);
            }
            throw e;
        }
    }

    @Patch(':id/status')
    changeStatus(@Param('id', ParseIntPipe) id: number, @Body() body: ChangeStatusDto) {
        return this.ordersService.changeStatus(id, body.status);
    }

    @Get(':id/events')
    async streamEvents(
        @Param('id', ParseIntPipe) id: number,
        @Headers('last-event-id') lastEventId: string | undefined,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        if (!(await this.orders.findById(id))) throw new NotFoundException(`Order ${id} not found`);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('retry: 1000\n\n');

        const subscription = this.events.stream(id, parseLastEventId(lastEventId)).subscribe({
            next: (event) => res.write(toSseFrame(event)),
            complete: () => res.end(),
        });
        const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

        req.on('close', () => {
            clearInterval(heartbeat);
            subscription.unsubscribe();
        });
    }
}
