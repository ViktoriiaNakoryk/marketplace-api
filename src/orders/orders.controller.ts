import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
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
    UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';
import { PageQueryDto } from '../common/page';
import { ChangeStatusDto } from './change-status.dto';
import { CreateOrderDto } from './create-order.dto';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersRepository, type OrderSummary } from './orders.repository';
import { OrdersService } from './orders.service';

const HEARTBEAT_MS = 15_000;

function toSseFrame(event: OrderStatusEvent): string {
    return `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseLastEventId(raw: string | undefined): number | undefined {
    const n = Number(raw);
    return raw !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
}

function assertCanSee(order: OrderSummary, user: AccessClaims): void {
    if (user.role !== 'admin' && order.buyerId !== user.sub) {
        throw new ForbiddenException(`Order ${order.id} belongs to another buyer`);
    }
}

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
    constructor(
        private readonly orders: OrdersRepository,
        private readonly ordersService: OrdersService,
        private readonly events: OrderEventsService,
    ) {}

    @Get()
    findAll(@Query() query: PageQueryDto, @CurrentUser() user: AccessClaims) {
        return this.orders.list(query.limit, query.cursor, user.role === 'admin' ? undefined : user.sub);
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessClaims) {
        const order = await this.orders.findById(id);
        if (!order) throw new NotFoundException(`Order ${id} not found`);
        assertCanSee(order, user);
        return order;
    }

    @Post()
    @HttpCode(201)
    async create(
        @Body() body: CreateOrderDto,
        @CurrentUser() user: AccessClaims,
        @Res({ passthrough: true }) res: Response,
        @Headers('idempotency-key') idempotencyKey?: string,
    ) {
        if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
        const buyerId = body.buyerId ?? user.sub;
        if (buyerId !== user.sub && user.role !== 'admin') {
            throw new ForbiddenException('Orders can only be placed on your own behalf');
        }
        try {
            const result = await this.ordersService.placeOrder({ buyerId, items: body.items }, idempotencyKey);
            if (!result) throw new BadRequestException('Order references an unknown product');
            if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
            return result.order;
        } catch (e) {
            if ((e as { code?: string }).code === '23503') {
                throw new BadRequestException(`Buyer ${buyerId} does not exist`);
            }
            throw e;
        }
    }

    @Patch(':id/status')
    @Roles('admin')
    changeStatus(@Param('id', ParseIntPipe) id: number, @Body() body: ChangeStatusDto) {
        return this.ordersService.changeStatus(id, body.status);
    }

    @Get(':id/events')
    async streamEvents(
        @Param('id', ParseIntPipe) id: number,
        @Headers('last-event-id') lastEventId: string | undefined,
        @CurrentUser() user: AccessClaims,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const order = await this.orders.findById(id);
        if (!order) throw new NotFoundException(`Order ${id} not found`);
        assertCanSee(order, user);

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
