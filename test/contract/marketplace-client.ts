export type OrderDto = {
    id: number;
    buyerId: number;
    status: string;
    total: number;
    items: { productId: number; name: string; quantity: number; unitPrice: number }[];
};

export type ProductDto = {
    id: number;
    sku: string;
    name: string;
    price: number;
    stock: number;
};

export class MarketplaceClient {
    constructor(private readonly baseUrl: string) {}

    getOrder(id: number): Promise<OrderDto> {
        return this.get(`/orders/${id}`);
    }

    getProduct(id: number): Promise<ProductDto> {
        return this.get(`/products/${id}`);
    }

    private async get<T>(path: string): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
        return (await res.json()) as T;
    }
}
