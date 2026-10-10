import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { checkout, CheckoutError } from './checkout';

const ATTEMPTS = 50;
const INITIAL_STOCK = 10;
const PRODUCT_ID = 1;

async function main(): Promise<void> {
    await AppDataSource.initialize();

    await AppDataSource.query(`UPDATE products SET stock = $1 WHERE id = $2`, [INITIAL_STOCK, PRODUCT_ID]);
    await AppDataSource.query(`UPDATE users SET balance = 100000000`);

    const buyers: Array<{ id: string }> = await AppDataSource.query(`SELECT id FROM users ORDER BY id`);

    const results = await Promise.allSettled(
        Array.from({ length: ATTEMPTS }, (_, i) =>
            checkout(AppDataSource, {
                buyerId: buyers[i % buyers.length].id,
                productId: PRODUCT_ID,
                quantity: 1,
            }),
        ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const outOfStock = results.filter(
        (r) => r.status === 'rejected' && r.reason instanceof CheckoutError && r.reason.reason === 'OUT_OF_STOCK',
    ).length;
    const unexpected = results.filter(
        (r) => r.status === 'rejected' && !(r.reason instanceof CheckoutError),
    );

    const [{ stock }] = await AppDataSource.query(`SELECT stock FROM products WHERE id = $1`, [PRODUCT_ID]);
    const [{ negative }] = await AppDataSource.query(`SELECT count(*)::int AS negative FROM products WHERE stock < 0`);

    console.log(`Спроб:                ${ATTEMPTS}`);
    console.log(`Успішних:             ${succeeded}`);
    console.log(`Відмов (немає товару): ${outOfStock}`);
    console.log(`Фінальний stock:      ${stock}`);
    console.log(`Рядків із stock < 0:  ${negative}`);

    if (unexpected.length > 0) {
        console.error(`Неочікувані помилки: ${unexpected.length}`);
        console.error((unexpected[0] as PromiseRejectedResult).reason);
    }

    const ok =
        succeeded === INITIAL_STOCK &&
        Number(stock) === 0 &&
        Number(negative) === 0 &&
        unexpected.length === 0;

    console.log('');
    console.log(ok ? '✅ Інваріант дотримано: жодного oversell.' : '❌ Інваріант порушено (oversell).');

    await AppDataSource.destroy();
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
