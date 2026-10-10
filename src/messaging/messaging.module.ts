import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { AmqpEventPublisher, DisabledEventPublisher, type EventPublisher } from './event-publisher';

export const EVENT_PUBLISHER = 'EVENT_PUBLISHER';

@Global()
@Module({
    providers: [
        {
            provide: EVENT_PUBLISHER,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>): EventPublisher => {
                const url = config.get('BROKER_URL', { infer: true });
                return url ? new AmqpEventPublisher(url) : new DisabledEventPublisher();
            },
        },
    ],
    exports: [EVENT_PUBLISHER],
})
export class MessagingModule implements OnModuleDestroy {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher) {}

    async onModuleDestroy() {
        await this.publisher.close();
    }
}
