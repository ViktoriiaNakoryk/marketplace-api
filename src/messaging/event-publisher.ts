import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { EXCHANGE } from './topology';

export type PublishedEvent = { eventId: string; type: string };

export interface EventPublisher {
    publish(routingKey: string, event: PublishedEvent): Promise<void>;
    close(): Promise<void>;
}

export class AmqpEventPublisher implements EventPublisher {
    private session?: Promise<{ connection: ChannelModel; channel: ConfirmChannel }>;

    constructor(private readonly url: string) {}

    async publish(routingKey: string, event: PublishedEvent): Promise<void> {
        await this.publishRaw(routingKey, Buffer.from(JSON.stringify(event)), {
            messageId: event.eventId,
            type: event.type,
        });
    }

    async publishRaw(routingKey: string, body: Buffer, props: { messageId: string; type: string }): Promise<void> {
        const { channel } = await this.open();
        channel.publish(EXCHANGE, routingKey, body, {
            ...props,
            persistent: true,
            contentType: 'application/json',
            timestamp: Math.floor(Date.now() / 1000),
        });
        await channel.waitForConfirms();
    }

    async close(): Promise<void> {
        const session = this.session;
        this.session = undefined;
        if (!session) return;
        const { connection } = await session.catch(() => ({ connection: undefined }));
        await connection?.close().catch(() => undefined);
    }

    private open() {
        if (!this.session) {
            const session = (async () => {
                const connection = await connect(this.url);
                const reset = () => {
                    if (this.session === session) this.session = undefined;
                };
                connection.on('close', reset);
                connection.on('error', reset);
                const channel = await connection.createConfirmChannel();
                return { connection, channel };
            })();
            session.catch(() => {
                if (this.session === session) this.session = undefined;
            });
            this.session = session;
        }
        return this.session;
    }
}

export class DisabledEventPublisher implements EventPublisher {
    async publish(routingKey: string): Promise<void> {
        throw new Error(`BROKER_URL is not set — ${routingKey} was not published`);
    }

    async close(): Promise<void> {}
}
