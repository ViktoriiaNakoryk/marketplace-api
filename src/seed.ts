import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

type ItemSpec = { order: number; product: number; quantity: number };

const userSpecs = [
    { email: 'olena.seller@shop.ua', fullName: 'Олена Кравченко', role: 'seller' as const },
    { email: 'ihor.seller@shop.ua', fullName: 'Ігор Мельник', role: 'seller' as const },
    { email: 'maria.admin@shop.ua', fullName: 'Марія Ткаченко', role: 'admin' as const },
    { email: 'petro.buyer@shop.ua', fullName: 'Петро Бондаренко', role: 'buyer' as const },
    { email: 'sofia.buyer@shop.ua', fullName: 'Софія Шевченко', role: 'buyer' as const },
    { email: 'andriy.buyer@shop.ua', fullName: 'Андрій Коваль', role: 'buyer' as const },
];

const productSpecs = [
    { seller: 0, sku: 'MP-0001', name: 'Кросівки шкіряні', description: 'Чоловічі шкіряні кросівки для міста', category: 'Взуття', brand: 'Nike', price: 249900 },
    { seller: 0, sku: 'MP-0002', name: 'Кеди текстильні', description: 'Легкі текстильні кеди на щодень', category: 'Взуття', brand: 'Puma', price: 159900 },
    { seller: 1, sku: 'MP-0003', name: 'Куртка зимова', description: 'Тепла зимова куртка з капюшоном', category: 'Одяг', brand: 'Zara', price: 349900 },
    { seller: 1, sku: 'MP-0004', name: 'Футболка бавовняна', description: 'Базова бавовняна футболка унісекс', category: 'Одяг', brand: 'Adidas', price: 79900 },
    { seller: 0, sku: 'MP-0005', name: 'Рюкзак міський', description: 'Місткий міський рюкзак для ноутбука', category: 'Аксесуари', brand: 'Samsonite', price: 129900 },
    { seller: 1, sku: 'MP-0006', name: 'Годинник смарт', description: 'Смарт-годинник з пульсометром', category: 'Електроніка', brand: 'Samsung', price: 599900 },
    { seller: 0, sku: 'MP-0007', name: 'Навушники бездротові', description: 'Бездротові навушники з шумозаглушенням', category: 'Електроніка', brand: 'Apple', price: 899900 },
    { seller: 1, sku: 'MP-0008', name: 'Сумка шкіряна', description: 'Жіноча шкіряна сумка через плече', category: 'Сумки', brand: 'Zara', price: 289900 },
    { seller: 0, sku: 'MP-0009', name: 'Джинси класичні', description: 'Класичні прямі джинси', category: 'Одяг', brand: 'Levis', price: 199900 },
    { seller: 1, sku: 'MP-0010', name: 'Кепка спортивна', description: 'Спортивна кепка з логотипом', category: 'Аксесуари', brand: 'Nike', price: 49900 },
];

const orderSpecs = [
    { buyer: 3, status: 'completed' as const },
    { buyer: 4, status: 'paid' as const },
    { buyer: 5, status: 'shipped' as const },
    { buyer: 3, status: 'completed' as const },
    { buyer: 4, status: 'pending' as const },
    { buyer: 5, status: 'cancelled' as const },
    { buyer: 3, status: 'refunded' as const },
    { buyer: 4, status: 'completed' as const },
];

const itemSpecs: ItemSpec[] = [
    { order: 0, product: 0, quantity: 1 },
    { order: 0, product: 3, quantity: 2 },
    { order: 1, product: 6, quantity: 1 },
    { order: 1, product: 9, quantity: 3 },
    { order: 2, product: 2, quantity: 1 },
    { order: 2, product: 4, quantity: 1 },
    { order: 2, product: 7, quantity: 1 },
    { order: 3, product: 1, quantity: 2 },
    { order: 3, product: 5, quantity: 1 },
    { order: 4, product: 8, quantity: 1 },
    { order: 4, product: 9, quantity: 2 },
    { order: 5, product: 0, quantity: 1 },
    { order: 6, product: 6, quantity: 1 },
    { order: 6, product: 3, quantity: 4 },
    { order: 7, product: 2, quantity: 1 },
    { order: 7, product: 5, quantity: 2 },
    { order: 7, product: 9, quantity: 1 },
];

async function main(): Promise<void> {
    await AppDataSource.initialize();

    await AppDataSource.transaction(async (manager) => {
        await manager.query('TRUNCATE TABLE "order_items", "orders", "products", "users" RESTART IDENTITY CASCADE');

        const users = await manager.getRepository(User).save(userSpecs);

        const products = await manager.getRepository(Product).save(
            productSpecs.map((p) => ({
                seller: users[p.seller],
                sku: p.sku,
                name: p.name,
                description: p.description,
                category: p.category,
                brand: p.brand,
                price: p.price,
            })),
        );

        const totals = orderSpecs.map(() => 0);
        for (const item of itemSpecs) {
            totals[item.order] += products[item.product].price * item.quantity;
        }

        const orders = await manager.getRepository(Order).save(
            orderSpecs.map((o, index) => ({
                buyer: users[o.buyer],
                status: o.status,
                total: totals[index],
            })),
        );

        await manager.getRepository(OrderItem).save(
            itemSpecs.map((item) => ({
                order: orders[item.order],
                product: products[item.product],
                quantity: item.quantity,
                unitPrice: products[item.product].price,
            })),
        );

        console.log(`seed: users=${users.length} products=${products.length} orders=${orders.length} order_items=${itemSpecs.length}`);
    });

    await AppDataSource.destroy();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
