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

@Entity('products')
@Check(`"price" > 0`)
@Check(`"stock" >= 0`)
export class Product {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @ManyToOne(() => User, (user) => user.products, {
        onDelete: 'RESTRICT',
        nullable: false,
    })
    @Index()
    seller: User;

    @Column({ type: 'text', unique: true })
    sku: string;

    @Column({ type: 'text' })
    name: string;

    @Column({ type: 'text' })
    description: string;

    @Index()
    @Column({ type: 'text' })
    category: string;

    @Column({ type: 'text' })
    brand: string;

    @Column({ type: 'int' })
    price: number;

    @Column({ type: 'int', default: 0 })
    stock: number;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @Index('idx_products_search_vector', { synchronize: false })
    @Column({
        type: 'tsvector',
        asExpression: `to_tsvector('simple', name || ' ' || description)`,
        generatedType: 'STORED',
        nullable: true,
        select: false,
    })
    searchVector: string;

    @OneToMany(() => OrderItem, (item) => item.product)
    orderItems: OrderItem[];
}
