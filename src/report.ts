import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { OrderItem } from './entities/order-item.entity';

type Row = {
    category: string;
    revenue: string;
    orders: string;
    units: string;
};

async function main(): Promise<void> {
    await AppDataSource.initialize();

    const rows = await AppDataSource.getRepository(OrderItem)
        .createQueryBuilder('oi')
        .innerJoin('oi.product', 'p')
        .innerJoin('oi.order', 'o')
        .select('p.category', 'category')
        .addSelect('SUM(oi.quantity * oi.unitPrice)', 'revenue')
        .addSelect('COUNT(DISTINCT o.id)', 'orders')
        .addSelect('SUM(oi.quantity)', 'units')
        .where('o.status IN (:...statuses)', { statuses: ['paid', 'shipped', 'completed'] })
        .groupBy('p.category')
        .orderBy('revenue', 'DESC')
        .getRawMany<Row>();

    console.log('Виторг по категоріях (замовлення paid/shipped/completed)');
    console.log('');
    console.log('Категорія      | Виторг, грн | Замовлень | Одиниць');
    console.log('---------------|-------------|-----------|--------');
    for (const row of rows) {
        const uah = (Number(row.revenue) / 100).toFixed(2);
        console.log(
            `${row.category.padEnd(14)} | ${uah.padStart(11)} | ${row.orders.padStart(9)} | ${row.units.padStart(7)}`,
        );
    }

    await AppDataSource.destroy();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
