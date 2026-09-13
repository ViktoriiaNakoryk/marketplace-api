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
