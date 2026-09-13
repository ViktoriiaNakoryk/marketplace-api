SELECT id, name, brand, price
FROM products
WHERE lower(sku) = 'mp-0000042'
