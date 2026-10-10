import {
    Check,
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity('order_items')
@Check(`"quantity" > 0`)
@Check(`"unitPrice" > 0`)
export class OrderItem {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @ManyToOne(() => Order, (order) => order.items, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    order: Order;

    @ManyToOne(() => Product, (product) => product.orderItems, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    product: Product;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int' })
    unitPrice: number;
}
