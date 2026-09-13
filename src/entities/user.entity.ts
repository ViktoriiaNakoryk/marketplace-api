import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { Order } from './order.entity';

@Entity('users')
@Check(`"role" IN ('buyer', 'seller', 'admin')`)
export class User {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @Column({ type: 'text', unique: true })
    email: string;

    @Column({ type: 'text' })
    fullName: string;

    @Column({ type: 'text', default: 'buyer' })
    role: 'buyer' | 'seller' | 'admin';

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @OneToMany(() => Product, (product) => product.seller)
    products: Product[];

    @OneToMany(() => Order, (order) => order.buyer)
    orders: Order[];
}
