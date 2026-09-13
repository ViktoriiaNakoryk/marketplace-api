\set ON_ERROR_STOP on

INSERT INTO users (email, full_name, role)
SELECT
    'user' || g || '@marketplace.ua',
    'Користувач ' || g,
    CASE
        WHEN random() < 0.90 THEN 'buyer'
        WHEN random() < 0.98 THEN 'seller'
        ELSE                     'admin'
    END
FROM generate_series(1, 1000) AS g;

INSERT INTO products (seller_id, sku, name, description, category, brand, price, created_at)
SELECT
    1 + floor(random() * 1000)::int,
    'MP-' || lpad(g::text, 7, '0'),
    noun || ' ' || adj,
    'Стильна модель: ' || noun || ' у виконанні «' || adj || '» від бренду ' || brand
        || '. ' || quality || ', колір ' || color || '.',
    category,
    brand,
    round((random() * 4950 + 50)::numeric, 2),
    now() - (random() * interval '730 days')
FROM (
    SELECT
        g,
        (ARRAY['кросівки','кеди','черевики','чоботи','сумка','рюкзак','гаманець','ремінь',
               'куртка','футболка','джинси','светр','шапка','рукавички','шкарпетки','окуляри',
               'годинник','парасоля','наплічник','кепка'])[1 + floor(random() * 20)::int]   AS noun,
        (ARRAY['шкіряні','замшеві','текстильні','вовняні','бавовняні','водонепроникні',
               'утеплені','легкі'])[1 + floor(random() * 8)::int]                            AS adj,
        (ARRAY['Взуття','Одяг','Аксесуари','Електроніка','Сумки'])[1 + floor(random() * 5)::int] AS category,
        (ARRAY['Nike','Adidas','Reebok','Puma','Zara','Bosch','Samsung','Apple','Xiaomi','Lenovo'])[1 + floor(random() * 10)::int] AS brand,
        (ARRAY['висока якість','преміум матеріали','ручна робота','сертифікований товар'])[1 + floor(random() * 4)::int] AS quality,
        (ARRAY['чорний','білий','синій','червоний','зелений','бежевий'])[1 + floor(random() * 6)::int] AS color
    FROM generate_series(1, 120000) AS g
) s;

INSERT INTO orders (buyer_id, status, total, created_at)
SELECT
    1 + floor(random() * 1000)::int,
    CASE
        WHEN r < 0.55 THEN 'completed'
        WHEN r < 0.70 THEN 'shipped'
        WHEN r < 0.82 THEN 'paid'
        WHEN r < 0.90 THEN 'cancelled'
        WHEN r < 0.96 THEN 'refunded'
        ELSE               'pending'
    END,
    round((random() * 2000 + 10)::numeric, 2),
    now() - (random() * interval '730 days')
FROM (SELECT g, random() AS r FROM generate_series(1, 120000) AS g) s;

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
    1 + floor(random() * 120000)::int,
    1 + floor(random() * 120000)::int,
    1 + floor(random() * 5)::int,
    round((random() * 1000 + 5)::numeric, 2)
FROM generate_series(1, 250000) AS g;

VACUUM (ANALYZE);
