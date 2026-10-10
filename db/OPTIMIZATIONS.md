# Оптимізація запитів: EXPLAIN до і після

Числа зняті на локальному Postgres 16 (`docker compose`), на чистій базі за пайплайном
грейдера: `schema.sql` → `seed.sql` (120 000 товарів, 120 000 замовлень, 250 000 позицій)
→ EXPLAIN «до» → `indexes.sql` → `ANALYZE` → EXPLAIN «після». Для q4 взято третій прогін
(перший після `CREATE INDEX` іде по холодному GIN).

Зведення:

| Запит | Execution Time до | Execution Time після | Прискорення | Buffers до → після |
|-------|-------------------|----------------------|-------------|--------------------|
| q1    | 3.954 ms          | 0.090 ms             | ~44×        | 1080 → 16          |
| q2    | 4.053 ms          | 0.152 ms             | ~27×        | 1080 → 52          |
| q3    | 24.688 ms         | 0.051 ms             | ~484×       | 8601 → 4           |
| q4    | 14.088 ms         | 1.769 ms             | ~8×         | 8607 → 719         |

---

## q1 — замовлення покупця за період

`WHERE buyer_id = 42 AND created_at >= now() - interval '30 days' ORDER BY created_at DESC`

**Індекс:** `idx_orders_buyer_created` — b-tree `(buyer_id, created_at DESC)`.

### До

```
                                                QUERY PLAN
----------------------------------------------------------------------------------------------------------
 Sort  (cost=3477.06..3477.07 rows=5 width=30) (actual time=3.931..3.932 rows=7 loops=1)
   Sort Key: created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=1080
   ->  Seq Scan on orders  (cost=0.00..3477.00 rows=5 width=30) (actual time=1.626..3.916 rows=7 loops=1)
         Filter: ((buyer_id = 42) AND (created_at >= (now() - '30 days'::interval)))
         Rows Removed by Filter: 119993
         Buffers: shared hit=1077
 Planning:
   Buffers: shared hit=100
 Planning Time: 0.222 ms
 Execution Time: 3.954 ms
```

### Після

```
                                                              QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=23.61..23.62 rows=5 width=30) (actual time=0.058..0.059 rows=7 loops=1)
   Sort Key: created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=13 read=3
   ->  Bitmap Heap Scan on orders  (cost=4.47..23.55 rows=5 width=30) (actual time=0.030..0.045 rows=7 loops=1)
         Recheck Cond: ((buyer_id = 42) AND (created_at >= (now() - '30 days'::interval)))
         Heap Blocks: exact=7
         Buffers: shared hit=10 read=3
         ->  Bitmap Index Scan on idx_orders_buyer_created  (cost=0.00..4.47 rows=5 width=0) (actual time=0.020..0.020 rows=7 loops=1)
               Index Cond: ((buyer_id = 42) AND (created_at >= (now() - '30 days'::interval)))
               Buffers: shared hit=3 read=3
 Planning:
   Buffers: shared hit=138 read=2
 Planning Time: 0.357 ms
 Execution Time: 0.090 ms
```

У план став `Bitmap Index Scan on idx_orders_buyer_created`: замість `Seq Scan`, який читав усі 120 000 рядків (`Rows Removed by Filter: 119993`) і 1077 сторінок купи, індекс одразу дає 7 потрібних рядків, а `Heap Blocks: exact=7` показує, що з купи піднято лише 7 сторінок — buffers впали 1080 → 16.

---

## q2 — черга нових замовлень (фільтр по статусу)

`WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50`

**Індекс:** `idx_orders_pending` — **partial** b-tree `(created_at DESC) WHERE status = 'pending'`.

### До

```
                                                      QUERY PLAN
----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=2738.84..2738.97 rows=50 width=30) (actual time=4.015..4.020 rows=50 loops=1)
   Buffers: shared hit=1080
   ->  Sort  (cost=2738.84..2751.02 rows=4872 width=30) (actual time=4.014..4.016 rows=50 loops=1)
         Sort Key: created_at DESC
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=1080
         ->  Seq Scan on orders  (cost=0.00..2577.00 rows=4872 width=30) (actual time=0.003..3.704 rows=4835 loops=1)
               Filter: (status = 'pending'::text)
               Rows Removed by Filter: 115165
               Buffers: shared hit=1077
 Planning:
   Buffers: shared hit=92
 Planning Time: 0.235 ms
 Execution Time: 4.053 ms
```

### Після

```
                                                               QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.28..45.00 rows=50 width=30) (actual time=0.026..0.130 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using idx_orders_pending on orders  (cost=0.28..4446.59 rows=4972 width=30) (actual time=0.025..0.127 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning:
   Buffers: shared hit=124
 Planning Time: 0.397 ms
 Execution Time: 0.152 ms
```

У план став `Index Scan using idx_orders_pending`, і разом із `Seq Scan` зник вузол `Sort`: partial-індекс уже впорядкований по `created_at DESC` і містить лише рядки `pending`, тож планер читає перші 50 і зупиняється по `LIMIT` — не сканує 120 000 рядків і не сортує 4835 (`top-N heapsort` пропав), buffers 1080 → 52.

---

## q3 — пошук товару за артикулом без урахування регістру

`WHERE lower(sku) = 'mp-0000042'`

**Індекс:** `idx_products_lower_sku` — **expression** b-tree `(lower(sku))`.

### До

```
                                                QUERY PLAN
----------------------------------------------------------------------------------------------------------
 Seq Scan on products  (cost=0.00..10401.00 rows=600 width=52) (actual time=0.019..24.652 rows=1 loops=1)
   Filter: (lower(sku) = 'mp-0000042'::text)
   Rows Removed by Filter: 119999
   Buffers: shared hit=8601
 Planning:
   Buffers: shared hit=86
 Planning Time: 0.279 ms
 Execution Time: 24.688 ms
```

### Після

```
                                                            QUERY PLAN
----------------------------------------------------------------------------------------------------------------------------------
 Index Scan using idx_products_lower_sku on products  (cost=0.42..8.44 rows=1 width=52) (actual time=0.020..0.020 rows=1 loops=1)
   Index Cond: (lower(sku) = 'mp-0000042'::text)
   Buffers: shared hit=1 read=3
 Planning:
   Buffers: shared hit=129 read=1
 Planning Time: 0.402 ms
 Execution Time: 0.051 ms
```

У план став `Index Scan using idx_products_lower_sku`. Ключове — це **expression**-індекс: звичайний індекс по `sku` тут був би мертвим, бо у `WHERE` стоїть функція `lower(sku)`, а не гола колонка. `Seq Scan`, що читав 120 000 рядків і 8601 сторінку, замінився на прямий пошук по індексу (`Index Cond`), buffers 8601 → 4.

---

## q4 — повнотекстовий пошук по каталогу

`WHERE search_vector @@ plainto_tsquery('simple', 'шкіряні кросівки') ORDER BY rank DESC, id LIMIT 20`

**Індекс:** `idx_products_search_vector` — **GIN** по генерованій `tsvector`-колонці. Запит чіпляє 725 із 120 000 товарів (~0.6%), тож планер справедливо обирає індекс.

### До

```
                                                       QUERY PLAN
------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=10122.48..10122.53 rows=20 width=44) (actual time=14.063..14.066 rows=20 loops=1)
   Buffers: shared hit=8607
   ->  Sort  (cost=10122.48..10124.33 rows=738 width=44) (actual time=14.062..14.063 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 26kB
         Buffers: shared hit=8607
         ->  Seq Scan on products  (cost=0.00..10102.84 rows=738 width=44) (actual time=0.058..13.976 rows=725 loops=1)
               Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
               Rows Removed by Filter: 119275
               Buffers: shared hit=8601
 Planning:
   Buffers: shared hit=124
 Planning Time: 0.329 ms
 Execution Time: 14.088 ms
```

### Після (3-й прогін, холодний GIN прогріто)

```
                                                                     QUERY PLAN
----------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=2321.01..2321.06 rows=20 width=44) (actual time=1.733..1.735 rows=20 loops=1)
   Buffers: shared hit=719
   ->  Sort  (cost=2321.01..2322.86 rows=740 width=44) (actual time=1.732..1.733 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 26kB
         Buffers: shared hit=719
         ->  Bitmap Heap Scan on products  (cost=62.20..2301.32 rows=740 width=44) (actual time=0.467..1.651 rows=725 loops=1)
               Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
               Heap Blocks: exact=701
               Buffers: shared hit=713
               ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..62.01 rows=740 width=0) (actual time=0.421..0.421 rows=725 loops=1)
                     Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                     Buffers: shared hit=12
 Planning:
   Buffers: shared hit=165
 Planning Time: 0.340 ms
 Execution Time: 1.769 ms
```

У план став `Bitmap Index Scan on idx_products_search_vector`: замість `Seq Scan`, що читав усі 120 000 рядків і 8601 сторінку, GIN за 12 сторінок віддає бітову карту зі 725 збігів, а `Bitmap Heap Scan` піднімає лише ці рядки (`Heap Blocks: exact=701`) — buffers 8607 → 719. `Sort` лишився: `ts_rank` рахується вже по знайдених 725 рядках і це дешево.

### Ціна збереженої tsvector-колонки

`pg_total_relation_size('products')` = **80 MB**, з них купа — 67 MB, і в ній ~**31 MB** припадає саме на збережений `search_vector` (решта — сам GIN-індекс 2.7 MB). Тобто генерована колонка роздуває таблицю приблизно вдвічі й сповільнює вставку — це нормальна ціна за пошук по каталогу, і її треба вміти назвати вголос.

---

## Морфологія

Одне й те саме слово у двох відмінках дає в базі два різні числа:

```
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');  -- 5883
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівок');  --    0
```

- **кросівки** (називний відмінок, як у каталозі) → **5883** збіги
- **кросівок** (родовий відмінок) → **0** збігів

Причина: конфігурація `simple` не має морфологічного словника — вона лише зводить слово в нижній регістр і не робить лематизації, тому «кросівки» і «кросівок» для неї — два різні лексеми, і пошук другою формою не знаходить нічого зі збереженого в першій. `SELECT count(*) FROM pg_ts_config;` показує **29** конфігурацій (`\dF`), і **української серед них немає** — є `russian`, але підміна `simple` на `russian` це не фікс, а самообман: російський стемер ламатиме українські слова за чужими правилами й однаково не поверне правильну форму. Повноцінна українська морфологія в пошуку — це вже окремий пошуковий рушій (тема лекції #15).
