import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

@Entity('orders')
@Check(`"status" IN ('pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded')`)
@Check(`"total" >= 0`)
export class Order {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @ManyToOne(() => User, (user) => user.orders, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    @Index()
    buyer: User;

    @Column({ type: 'text' })
    status: 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'refunded';

    @Column({ type: 'int' })
    total: number;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
    items: OrderItem[];
}
