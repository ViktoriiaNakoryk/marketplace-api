import type { NewUser } from '../../src/users/users.repository';
import type { NewProduct } from '../../src/products/products.repository';
import type { NewOrder } from '../../src/orders/orders.repository';

let seq = 0;
const unique = () => `${process.pid}-${Date.now().toString(36)}-${++seq}`;

export function aUser(overrides: Partial<NewUser> = {}): NewUser {
    const id = unique();
    return {
        email: `user-${id}@test.local`,
        fullName: `Test User ${id}`,
        role: 'buyer',
        balance: 1_000_000,
        ...overrides,
    };
}

export function aSeller(overrides: Partial<NewUser> = {}): NewUser {
    return aUser({ role: 'seller', ...overrides });
}

export function aProduct(sellerId: number, overrides: Partial<NewProduct> = {}): NewProduct {
    const id = unique();
    return {
        sellerId,
        sku: `SKU-${id}`,
        name: `Product ${id}`,
        description: `Description of product ${id}`,
        category: 'Test',
        brand: 'Acme',
        price: 19_900,
        stock: 10,
        ...overrides,
    };
}

export function anOrder(buyerId: number, overrides: Partial<NewOrder> = {}): NewOrder {
    return { buyerId, items: [], ...overrides };
}

export function anItem(productId: number, quantity = 1): NewOrder['items'][number] {
    return { productId, quantity };
}
