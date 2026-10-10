import type { OrderView } from '../orders/orders.repository';

export type OrderPlacedEvent = {
    eventId: string;
    type: 'order.placed';
    version: 1;
    occurredAt: string;
    data: {
        orderId: number;
        buyerId: number;
        total: number;
        currency: 'UAH';
        items: { productId: number; quantity: number; unitPrice: number }[];
    };
};

export class InvalidEventError extends Error {
    constructor(reason: string) {
        super(`invalid order.placed event: ${reason}`);
        this.name = 'InvalidEventError';
    }
}

export function orderPlacedEvent(order: OrderView): OrderPlacedEvent {
    return {
        eventId: `order.placed:${order.id}`,
        type: 'order.placed',
        version: 1,
        occurredAt: order.createdAt,
        data: {
            orderId: order.id,
            buyerId: order.buyerId,
            total: order.total,
            currency: 'UAH',
            items: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
        },
    };
}

const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

export function parseOrderPlaced(content: Buffer): OrderPlacedEvent {
    let body: any;
    try {
        body = JSON.parse(content.toString('utf8'));
    } catch {
        throw new InvalidEventError('body is not JSON');
    }
    if (body?.type !== 'order.placed') throw new InvalidEventError(`unexpected type ${body?.type}`);
    if (body.version !== 1) throw new InvalidEventError(`unsupported version ${body.version}`);
    if (typeof body.eventId !== 'string' || body.eventId === '') throw new InvalidEventError('eventId is missing');
    if (!isPositiveInt(body.data?.orderId)) throw new InvalidEventError('data.orderId is not a positive integer');
    if (!isPositiveInt(body.data?.buyerId)) throw new InvalidEventError('data.buyerId is not a positive integer');
    return body as OrderPlacedEvent;
}
