import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrderStatus, OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
    constructor(
        private readonly orders: OrdersRepository,
        private readonly events: OrderEventsService,
    ) {}

    async changeStatus(orderId: number, status: OrderStatus): Promise<OrderStatusEvent> {
        const change = await this.orders.updateStatus(orderId, status);
        if (!change) throw new NotFoundException(`Order ${orderId} not found`);
        return this.events.publish(change);
    }
}
