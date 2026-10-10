import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { concat, filter, from, Observable, Subject } from 'rxjs';
import type { OrderStatus, StatusChange } from './orders.repository';

export type OrderStatusEvent = {
    id: number;
    orderId: number;
    status: OrderStatus;
    previousStatus: OrderStatus;
    changedAt: string;
};

const BUFFER_SIZE = 100;

@Injectable()
export class OrderEventsService implements OnModuleDestroy {
    private readonly subject = new Subject<OrderStatusEvent>();
    private readonly buffers = new Map<number, OrderStatusEvent[]>();
    private readonly sequences = new Map<number, number>();

    readonly events$: Observable<OrderStatusEvent> = this.subject.asObservable();

    publish(change: StatusChange): OrderStatusEvent {
        const id = (this.sequences.get(change.orderId) ?? 0) + 1;
        this.sequences.set(change.orderId, id);

        const event: OrderStatusEvent = {
            id,
            orderId: change.orderId,
            status: change.status,
            previousStatus: change.previousStatus,
            changedAt: new Date().toISOString(),
        };

        const buffer = this.buffers.get(change.orderId) ?? [];
        buffer.push(event);
        if (buffer.length > BUFFER_SIZE) buffer.splice(0, buffer.length - BUFFER_SIZE);
        this.buffers.set(change.orderId, buffer);

        this.subject.next(event);
        return event;
    }

    since(orderId: number, lastEventId: number): OrderStatusEvent[] {
        return (this.buffers.get(orderId) ?? []).filter((e) => e.id > lastEventId);
    }

    stream(orderId: number, lastEventId?: number): Observable<OrderStatusEvent> {
        const missed = lastEventId === undefined ? [] : this.since(orderId, lastEventId);
        const seen = missed.length ? missed[missed.length - 1].id : (lastEventId ?? 0);
        const live = this.events$.pipe(filter((e) => e.orderId === orderId && e.id > seen));
        return concat(from(missed), live);
    }

    onModuleDestroy() {
        this.subject.complete();
    }
}
