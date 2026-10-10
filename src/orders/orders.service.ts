import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EVENT_PUBLISHER } from '../messaging/messaging.module';
import type { EventPublisher } from '../messaging/event-publisher';
import { orderPlacedEvent } from '../messaging/order-placed.event';
import { ORDER_PLACED } from '../messaging/topology';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { NewOrder, OrderStatus, OrdersRepository, OrderView } from './orders.repository';

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private readonly orders: OrdersRepository,
        private readonly events: OrderEventsService,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    ) {}

    async placeOrder(input: NewOrder): Promise<OrderView | null> {
        const order = await this.orders.create(input);
        if (!order) return null;

        const event = orderPlacedEvent(order);
        try {
            await this.publisher.publish(ORDER_PLACED, event);
        } catch (e) {
            this.logger.error(`${event.eventId} committed but not published: ${(e as Error).message}`);
        }
        return order;
    }

    async changeStatus(orderId: number, status: OrderStatus): Promise<OrderStatusEvent> {
        const change = await this.orders.updateStatus(orderId, status);
        if (!change) throw new NotFoundException(`Order ${orderId} not found`);
        return this.events.publish(change);
    }
}
