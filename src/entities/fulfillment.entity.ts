import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';
import { Order } from './order.entity';

@Entity('fulfillments')
@Unique(['eventId'])
@Unique(['order'])
@Check(`"status" IN ('queued', 'packed', 'shipped')`)
export class Fulfillment {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @Column({ type: 'text' })
    eventId: string;

    @ManyToOne(() => Order, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'orderId' })
    order: Order;

    @Column({ type: 'text', default: 'queued' })
    status: 'queued' | 'packed' | 'shipped';

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;
}
