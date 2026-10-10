# Restore drill — протокол

| Параметр | Значення |
|----------|----------|
| Дата drill-у | 2026-10-10 15:58 CEST |
| Джерело | Postgres 16.15 (`db` у `docker-compose.yml`), база `marketplace` |
| Дамп | `backups/marketplace_2026-10-10_155838.dump` (`pg_dump -Fc`) |
| Розмір дампу | **20 116 байт** (~20 KB) |
| Час бекапу | **0.26 с** (`scripts/backup.sh`, від старту до готового файла) |
| Ціль відновлення | новий контейнер `postgres:16-alpine` + новий порожній volume `marketplace-restore-drill-pgdata` (створюються скриптом, прибираються після) |
| Підйом чистого Postgres | **0.8 с** |
| `pg_restore --no-owner --no-acl` | **0.1 с** |
| Час відновлення до перевірених даних | **1.0 с** (старт контейнера → restore → контрольні значення) |
| Весь `scripts/restore-drill.sh` | **1.3 с** wall-clock |
| Результат | **MATCH** |

## Контрольні значення

Кількість рядків у кожній таблиці `public` + агрегат по ключовій таблиці `orders` (`count|sum(total)`):

```
before = jobs=0 migrations=2 order_items=17 orders=8 products=10 typeorm_metadata=1 users=6 | orders(count|sum_total)=8|6517400
after  = jobs=0 migrations=2 order_items=17 orders=8 products=10 typeorm_metadata=1 users=6 | orders(count|sum_total)=8|6517400
MATCH
```

## RTO / RPO

- **RTO (виміряний) ≈ 1 секунда** — стільки зайняло технічне відновлення дампу ~20 KB у чистий
  контейнер разом із перевіркою. Це нижня межа: на реальному інциденті до неї додаються
  виявлення проблеми, рішення відновлюватись і перемикання застосунку (оновити `DATABASE_URL`
  у сховищі / `[databases]` у PgBouncer). Чесний операційний бюджет — **~15 хвилин**,
  з яких машинна частина — секунди. Час `pg_restore` росте лінійно з розміром бази, тож
  drill треба повторювати, коли дамп виросте на порядок.
- **RPO = до 24 годин.** Бекап запускається раз на добу (`backup.cron`: `0 3 * * *`), тому в
  найгіршому випадку (падіння за мить до наступного запуску) губимо все, що записано за
  останні ~24 години. Зменшити RPO можна лише частішим розкладом або WAL-архівацією/PITR
  (тоді RPO — хвилини або секунди).

## Як відтворити

```bash
docker compose up -d --wait
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```
