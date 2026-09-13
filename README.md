# Marketplace API

## Configuration

Уся конфігурація застосунку описана однією zod-схемою в `src/config/env.schema.ts`
і перевіряється при старті. Якщо якоїсь змінної бракує або вона зламана — застосунок
**не запуститься** й напише, що саме не так. Краще впасти одразу, ніж на першому запиті в проді.

Повний список із прикладами лежить у `.env.example`. Щоб почати — просто скопіюй його:

```bash
cp .env.example .env
```

| Змінна             | Призначення                                                        | За замовч.            | Джерело значення |
|--------------------|--------------------------------------------------------------------|-----------------------|------------------|
| `PORT`             | порт HTTP-сервера                                                  | `3000`                | `.env`           |
| `LOG_LEVEL`        | рівень логів: `debug`/`info`/`warn`/`error`                        | `info`                | `.env`           |
| `DB_URL`           | рядок підключення до Postgres (без пароля)                         | —                     | **сховище секретів (ДЗ #11)** |
| `DB_PASSWORD_FILE` | шлях до файла з паролем БД (пароль читається окремо, не з URL)     | `./secrets/db_password` | сховище секретів (ДЗ #11) |

`DB_URL` — це змінна підключення застосунку до бази. Її значення застосунок бере зі
**сховища секретів, заведеного в ДЗ #11** (оточення `dev`/`prod`), а не з нового env-файла:
`.env` у git не потрапляє (див. `.gitignore`), у репозиторії лежить лише `.env.example`
з фейковим значенням. Пароль винесений в окремий файл навмисно — його можна ротувати
«на живу», без перезапуску застосунку (`bash rotate.sh`).

Перевірити, що схема й `.env.example` не розійшлися:

```bash
npm run check:env
```

---

## ORM data layer (ДЗ #13)

Схема з ДЗ #12 переїхала в TypeORM: entities + relations + міграції, `synchronize: false`.

- **Головна таблиця:** `orders`. **Таблиця каталогу:** `products`.
- Гроші — `integer` у **мінорних одиницях** (копійки): `price`, `total`, `unitPrice`; не float.
- Початкова схема створюється **згенерованою міграцією** `src/migrations/*-InitialSchema.ts`
  (прочитана; руками дописано тільки `CREATE INDEX … USING GIN ("searchVector")` — генератор
  не емітить метод індексу). `down()` реально відкочує.

### Команди

Усі команди, що ходять у базу, загорнуті в обгортку секретів `scripts/with-secrets.sh dev …`
(з ДЗ #11): у звичайному режимі вона підставляє `DB_*` зі сховища, у грейдера — режим
`SKIP_VAULT=1` (див. [## Grading](#grading)).

| Команда | Що робить |
|---------|-----------|
| `npm run build` | компіляція `tsc` у `dist/` |
| `npm run migrate` | застосувати міграції |
| `npm run migrate:show` | список міграцій (`[X]`/`[ ]`) |
| `npm run migrate:revert` | відкотити останню міграцію |
| `npm run seed` | детермінований ідемпотентний seed |
| `npm run demo:nplus1` | демо N+1 «до/після» з лічильником запитів |
| `npm run report` | звіт через `createQueryBuilder().getRawMany()` |

### Seed — ідемпотентність

`src/seed.ts` детермінований (жодного `random()`): на старті робить `TRUNCATE … RESTART IDENTITY
CASCADE` і насіває фіксований набір, тож другий запуск не дублює рядків і не падає. Перевірка:

```bash
npm run seed && npm run seed
docker compose exec -T db psql -U admin -d marketplace -Atc "SELECT 'users',count(*) FROM users UNION ALL SELECT 'products',count(*) FROM products UNION ALL SELECT 'orders',count(*) FROM orders UNION ALL SELECT 'order_items',count(*) FROM order_items;"
```

Після будь-якого запуску: `users=6`, `products=10`, `orders=8`, `order_items=17`.

### N+1: до і після

Граф `order → items → product`, вибірка з 8 замовлень / 17 позицій (`npm run demo:nplus1`):

| Стратегія | Запитів |
|-----------|---------|
| наївно (запит на елемент у циклі) | **26** |
| `relations` / `leftJoinAndSelect` (один JOIN) | **1** |
| `relationLoadStrategy: 'query'` | **5** |

«До» росте з розміром вибірки (`1 + orders + items`). «Після» — константа, що не залежить від N:
JOIN дає 1 запит, а `'query'` дає `1 + 2 × рівнів` = 5 на два рівні зв'язків.

### Repository vs QueryBuilder

Межу проводжу за формою результату. `find()` / репозиторій — коли результат лягає в entity-графи
(списки, картки, деталі «сутність + її зв'язки»). Щойно запит перестає повертати рядки таблиці —
агрегати (`SUM`, `COUNT`), `GROUP BY`, кілька таблиць у плоский рядок — беру
`createQueryBuilder().getRawMany()` (`src/report.ts`, «виторг по категоріях»): це вже звіт, а не
сутність, і тягнути його через `find()` означало б довантажувати зайве й рахувати агрегати в JS.

### Вибір onDelete

| Зв'язок | onDelete | Чому |
|---------|----------|------|
| `order_items → orders` | **CASCADE** | позиції — частина замовлення, живуть і зникають разом із ним |
| `order_items → products` | **RESTRICT** | не даємо видалити товар, поки він у історії замовлень |
| `products → users` (продавець) | **RESTRICT** | продавця з товарами не видалити — захист історії |
| `orders → users` (покупець) | **RESTRICT** | замовлення покупця — фінансова історія, її не осиротити |

---

## Grading

Грейдер піднімає БД зі свіжого клону й доступу до сховища не має. `DB_*` беруться з дев-креденшелів
`docker-compose.yml` (вони не секрет), а обгортка секретів пропускається через `SKIP_VAULT=1`:

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1
```

Далі — стандартний конвеєр:

```bash
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed && npm run seed
npm run demo:nplus1
npm run report
```

---

## База даних та оптимізація (ДЗ #12)

- **Головна таблиця обсягу:** `orders` (120 000 рядків).
- **Таблиця пошуку (q4):** `products` (120 000 рядків).

Дев-креденшели стенда живуть просто в `docker-compose.yml` (це не секрет — вони потрібні
грейдеру на свіжому клоні): користувач `admin`, база `marketplace`.

**Підняти базу** (одна команда, працює на свіжому клоні без правок файлів):

```bash
docker compose up -d --wait
```

**Підключитися** (одна команда):

```bash
docker compose exec db psql -U admin -d marketplace
```

### Повний цикл перевірки (як у грейдера)

Порядок = чистий volume → схема → seed → EXPLAIN «до» (Seq Scan) → індекси → ANALYZE → EXPLAIN «після».

```bash
# 0. чистий стенд
docker compose down -v && docker compose up -d --wait

# 1. схема (генерована tsvector-колонка вже тут)
docker compose exec -T db psql -U admin -d marketplace < db/schema.sql

# 2. seed: ≥100 000 рядків + VACUUM (ANALYZE) в кінці
docker compose exec -T db psql -U admin -d marketplace < db/seed.sql

# 3. EXPLAIN «до» — кожен запит дає Seq Scan
for q in q1 q2 q3 q4; do \
  docker compose exec -T db psql -U admin -d marketplace \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/$q.sql)"; done

# 4. індекси + оновлення статистики
docker compose exec -T db psql -U admin -d marketplace < db/indexes.sql
docker compose exec -T db psql -U admin -d marketplace -c "ANALYZE;"

# 5. EXPLAIN «після» — індексний план, без Seq Scan
#    (q4 прожени 2–3 рази й бери останній: перший після CREATE INDEX іде по холодному GIN)
for q in q1 q2 q3 q4; do \
  docker compose exec -T db psql -U admin -d marketplace \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/$q.sql)"; done
```

Повні виводи EXPLAIN до/після, пояснення до кожного запиту й секція **Морфологія** — у
[`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

| Файл | Призначення |
|------|-------------|
| `db/schema.sql`      | таблиці, констрейнти, генерована tsvector-колонка |
| `db/seed.sql`        | генерація даних (≥100 000 рядків) + `VACUUM (ANALYZE)` |
| `db/queries/q1..q3`  | реальні запити API (по одному statement) |
| `db/queries/q4.sql`  | повнотекстовий пошук по каталогу |
| `db/indexes.sql`     | усі індекси оптимізації, включно з GIN під q4 |
| `db/OPTIMIZATIONS.md`| 4 пари EXPLAIN до/після + пояснення + Морфологія |

---

## Запуск застосунку

1. Підняти базу:

   ```bash
   docker compose up -d --wait
   ```

   Postgres сам створить користувача `appuser` через `init.sql`.

2. Покласти пароль у файл-секрет (значення має збігатися з тим, що в `init.sql`):

   ```bash
   mkdir -p secrets && printf 'app-v1-password' > secrets/db_password
   ```

3. Поставити залежності та запустити:

   ```bash
   npm ci
   npm run start
   ```

   Застосунок буде на http://localhost:3000

4. Перевірити, що живий і бачить базу:

   ```bash
   curl localhost:3000/health       # чи живий застосунок
   curl localhost:3000/health/db    # чи ходить у базу
   ```

### Як поміняти пароль БД без перезапуску

Пароль до бази можна змінити, і застосунок навіть не помітить — жодного рестарту.

1. Подивись поточний uptime, щоб потім порівняти:

   ```bash
   curl localhost:3000/health
   ```

2. Запусти ротацію:

   ```bash
   bash rotate.sh
   ```

   Скрипт згенерує новий пароль, оновить його в базі та у файлі-секреті й закриє старі з'єднання.

3. Перевір, що все працює далі:

   ```bash
   curl localhost:3000/health/db    # має відповісти 200 — уже з новим паролем
   curl localhost:3000/health       # uptime більший, ніж був — значить, рестарту не було
   ```
