import { OnModuleDestroy } from '@nestjs/common';
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { OrderEventsService } from './order-events.service';
import { OrdersRepository } from './orders.repository';

export const orderRoom = (orderId: number) => `orders:${orderId}`;

type JoinAck = { ok: true; room: string } | { ok: false; error: 'UNAUTHORIZED' | 'BAD_REQUEST' | 'FORBIDDEN' };

@WebSocketGateway({ cors: { origin: '*' } })
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
    @WebSocketServer()
    server: Server;

    private subscription?: Subscription;

    constructor(
        private readonly events: OrderEventsService,
        private readonly orders: OrdersRepository,
    ) {}

    afterInit() {
        this.subscription = this.events.events$.subscribe((event) => {
            this.server.to(orderRoom(event.orderId)).emit('order.status', event);
        });
    }

    handleConnection(client: Socket) {
        const userId = Number(client.handshake.auth?.userId);
        client.data.userId = Number.isInteger(userId) && userId > 0 ? userId : null;
    }

    @SubscribeMessage('join')
    async join(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId?: unknown }): Promise<JoinAck> {
        const userId = client.data.userId as number | null;
        if (!userId) return { ok: false, error: 'UNAUTHORIZED' };

        const orderId = Number(body?.orderId);
        if (!Number.isInteger(orderId) || orderId < 1) return { ok: false, error: 'BAD_REQUEST' };

        const order = await this.orders.findById(orderId);
        if (!order || order.buyerId !== userId) return { ok: false, error: 'FORBIDDEN' };

        const room = orderRoom(orderId);
        await client.join(room);
        return { ok: true, room };
    }

    onModuleDestroy() {
        this.subscription?.unsubscribe();
    }
}
