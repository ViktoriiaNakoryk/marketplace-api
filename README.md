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
| `DB_URL`           | рядок підключення через PgBouncer `:6432` (без пароля)                       | —                     | **сховище секретів (ДЗ #11)** |
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

## Realtime (ДЗ #18)

Подія «статус замовлення змінився» доходить до клієнта двома транспортами з однієї шини:

```
PATCH /orders/:id/status ─► OrdersService.changeStatus ─► OrdersRepository.updateStatus (UPDATE … RETURNING)
                                         │
                                         ▼
                         OrderEventsService (Subject + буфер останніх 100 подій на замовлення)
                           ├─► OrdersGateway ─► server.to('orders:<id>').emit('order.status', …)   (socket.io)
                           └─► GET /orders/:id/events ─► text/event-stream з id: / event: / data:   (SSE)
```

| Файл | Призначення |
|------|-------------|
| `src/orders/order-events.service.ts` | шина подій (`Subject`), лічильник `id` на замовлення, буфер для `Last-Event-ID` |
| `src/orders/orders.service.ts` | бізнес-логіка зміни статусу: оновлення в БД → `publish` у шину |
| `src/orders/orders.gateway.ts` | `join` → перевірка власника → кімната `orders:<id>`; релей шини в кімнату |
| `src/orders/orders.controller.ts` | `PATCH /orders/:id/status`, `GET /orders/:id/events` (SSE) |
| `scripts/realtime-demo.mjs` | headless-демо ізоляції кімнат + контрольний режим `--same-room` |

**WebSocket.** Клієнт підключається з `auth: { userId }` у handshake (заглушка замість JWT, поки
в курсовому немає автентифікації) і шле `join` з `{ orderId }`. Ack — `{ ok: true, room }` або
`{ ok: false, error }`: `UNAUTHORIZED` для анонімного сокета, `FORBIDDEN` для чужого або
неіснуючого замовлення (існування чужих замовлень не розкриваємо). Емісія йде лише в кімнату
`orders:<id>`, не всім.

**SSE.** `GET /orders/:id/events` одразу шле `retry: 1000` (клієнт реконектиться за секунду), далі
кожна подія — блок `id: <n>`, `event: order.status`, `data: {…JSON зі статусом…}`; кожні 15 с
коментар `: ping` тримає зʼєднання крізь проксі. `id` зростає в межах замовлення. Клієнт із
`Last-Event-ID: N` спершу отримує з буфера пропущені події з `id > N`, потім живий потік без дублів
(реплей і підписка відбуваються в одному тіку). Неіснуюче замовлення → `404`.

### Запуск і демо

```bash
docker compose up -d --wait
export DB_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export DATABASE_URL=$DB_URL SKIP_VAULT=1
npm ci
npm run build
npm run migrate
npm run seed
node dist/main.js
```

В іншому терміналі (застосунок на `http://localhost:3000`; `BASE_URL=…` перевизначає адресу):

```bash
node scripts/realtime-demo.mjs; echo "exit=$?"
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"
```

Скрипт бере з `GET /orders` два замовлення різних покупців (A і B), підключає двох клієнтів,
чекає ack від `join`, потім через `PATCH` міняє статус A і через 1.5 с друкує, хто що почув.
Основний прогін: клієнти в різних кімнатах, очікування `B_RECEIVED=0`. З `--same-room` клієнт B
заходить у кімнату A тим самим кодом (від імені власника A), і успіх — `B_RECEIVED=1`. Додатково
друкується `FOREIGN_JOIN=FORBIDDEN`: покупець B пробує зайти в кімнату чужого замовлення A і
отримує відмову. Мій прогін:

```
demo: A=user 4 in orders:1, B=user 5 in orders:2
FOREIGN_JOIN=FORBIDDEN
demo: order 1 paid → shipped (event id 6)
A_RECEIVED=1
B_RECEIVED=0
exit=0

demo: A=user 4 in orders:1, B=user 4 in orders:1 (--same-room)
FOREIGN_JOIN=FORBIDDEN
demo: order 1 shipped → paid (event id 7)
A_RECEIVED=1
B_RECEIVED=1
exit=0
```

SSE руками:

```bash
curl -sN http://localhost:3000/orders/1/events
for s in paid shipped completed refunded; do
  curl -s -X PATCH localhost:3000/orders/1/status -H 'Content-Type: application/json' -d "{\"status\":\"$s\"}"; echo
done
curl -sN --max-time 2 -H 'Last-Event-ID: 3' http://localhost:3000/orders/1/events | grep '^id:'
```

**Два інстанси й більше.** Кімнати й буфер подій живуть у памʼяті процесу: якщо `PATCH` прийде на
інстанс 1, а сокет покупця підключений до інстанса 2, `server.to('orders:<id>')` на інстансі 1
нікого не знайде, і подія загубиться (так само SSE-клієнт на інстансі 2 і його `Last-Event-ID`
не побачать подію з інстанса 1). Лікується `@socket.io/redis-adapter`, який розсилає емісії в
кімнати через Redis pub/sub між усіма інстансами (плюс sticky sessions для long-polling), а
буфер для SSE виноситься в спільне сховище (Redis Streams).

## Trade-offs: WebSocket vs SSE

Для нотифікацій про статус замовлення в проді я лишила б **SSE**. Потік односпрямований
(сервер → покупець), а SSE дає реконект і догравання пропущеного через `Last-Event-ID` з коробки
браузера, ходить звичайним HTTP крізь будь-які проксі та балансувальники і не тягне окремого
протоколу й клієнтської бібліотеки. WebSocket варто брати, коли зʼявиться справжній двосторонній
обмін (чат продавця з покупцем, live-торги).

| Критерій | WebSocket (socket.io) | SSE |
|----------|-----------------------|-----|
| Напрям каналу | двосторонній: клієнт шле `join`, ack, будь-які події | односпрямований сервер → клієнт; команди клієнта — окремими HTTP-запитами |
| Реконект і відновлення | реконект робить socket.io-client (events на `socket.io` manager-і), але пропущені за час обриву події втрачені — догравання треба писати самому | `EventSource` реконектиться сам через `retry:` і шле `Last-Event-ID`; сервер доганяє з буфера — у нас це вже працює |
| Вимоги до інфраструктури | Upgrade-handshake, проксі мають пропускати `Upgrade`/`Connection`; для кількох інстансів — Redis-адаптер і sticky sessions | звичайна довга HTTP-відповідь: працює крізь будь-який HTTP-проксі/CDN (треба лише вимкнути буферизацію, `X-Accel-Buffering: no`); на HTTP/1.1 ліміт ~6 зʼєднань на домен у браузері, на HTTP/2 зникає |
| Ціна на подію | малий фрейм (2–14 байт заголовка) + пакет socket.io (`42["order.status",{…}]`) | текстовий блок `id:`/`event:`/`data:` (десятки байт службового тексту), лише UTF-8, бінарне — через base64 |
| Авторизація | токен у handshake (`auth`), перевірка на `join` | звичайні cookie/заголовки HTTP; нативний `EventSource` не вміє кастомні заголовки — лише cookie або токен у query |
| Клієнт | потрібна бібліотека socket.io-client (протокол socket.io ≠ голий WebSocket) | вбудований у браузер `EventSource`, у CLI достатньо `curl -N` |

---

## Тестування (ДЗ #16)

«Драбинка довіри»: unit → integration проти справжнього Postgres → E2E усього Nest-застосунку →
контракт із фронтендом через Pact + брокер + `can-i-deploy`.

| Команда | Що ганяє | Postgres |
|---------|----------|----------|
| `npm test` | unit-тести контролерів (`src/**/*.spec.ts`) | — |
| `npm run test:integration` | репозиторії `Users`/`Products`/`Orders` (`test/integration/`) | testcontainers |
| `npm run test:e2e` | повний `AppModule` через supertest (`test/e2e/`) | testcontainers |
| `npm run test:contract` | consumer-тест уявного фронтенду `marketplace-web` → `pacts/*.json` | — |
| `npm run verify:provider` | справжній застосунок проти контракту зі `stateHandlers` | testcontainers |

Усе — один `jest.config.ts` з `projects` (`--selectProjects …`), `reporters: ['default']`,
`maxWorkers: 1` (кожен воркер множив би контейнери). Збірка тестів — `ts-jest` (це `tsc`, тож
decorator-метадані на місці). NestJS 12 — ESM-only, тому скрипти запускають jest з
`NODE_OPTIONS=--experimental-vm-modules` (нативний `require(esm)` у Jest 30 на Node ≥ 24.9).

**Testcontainers.** `test/testkit/global-setup.ts` піднімає `postgres:16-alpine`
(`PostgreSqlContainer`), проганяє ті самі TypeORM-міграції, що й прод, і віддає
`container.getConnectionUri()` у `DB_URL`. Сховище для тестів не потрібне: адреса бази
народжується в рантаймі. `global-teardown.ts` зупиняє контейнер.

**Що покрито понад мок.** `23505` (unique `email`, `sku`), `23503` (FK на продавця/покупця),
`23514` (CHECK `price > 0`); підрахунок `total` з цін каталогу через `JOIN` в одному
data-modifying CTE; атомарність (невідомий товар → жодного рядка в `orders`); `json_agg` позицій;
keyset-пагінація.

**Ізоляція — транзакція + ROLLBACK.** Кожен integration-тест працює в одному `pg.Client`:
`BEGIN` у `beforeEach`, `ROLLBACK` в `afterEach` (`test/testkit/transaction.ts`). Репозиторії
приймають будь-що з `query()` (`Pool` або `Client`), тож у тесті вони працюють у тій самій
транзакції. Обрала ROLLBACK, бо він найдешевший (нічого не видаляється, лише відкочується) і
найчистіший: тест не бачить даних сусіда й не залежить від порядку запуску. Разом зі свіжим
контейнером на кожен прогін `npm run test:integration && npm run test:integration` зелений без
ручної чистки. E2E і provider так не можуть (застосунок комітить через власний пул), тому там
ізоляція — свіжий контейнер на прогін + унікальні дані з builders / `ON CONFLICT DO NOTHING`.

**Test data builders.** `test/testkit/builders.ts`: `aUser()`, `aSeller()`, `aProduct(sellerId)`,
`anOrder(buyerId)`, `anItem(productId)` — валідні дефолти з унікальними `email`/`sku`, у тесті
перевизначається лише те, що важливе для сценарію.

**E2E.** `Test.createTestingModule({ imports: [AppModule] })` без підмін провайдерів, пайпи —
зі спільної `configureApp()` (`src/app.setup.ts`), яку викликає і `main.ts`. Сценарій:
`POST /orders` → `GET /orders/{id}`, плюс `404` на неіснуюче замовлення і `400` від `ValidationPipe`
на порожній `items`.

**Контракт.** `test/contract/consumer.pact-spec.ts` описує дві interaction з provider state:
`GET /orders/9001` (`order 9001 exists`) і `GET /products/9001` (`product 9001 exists`); форма тіла
задана матчерами `MatchersV3` і відповідає схемам `Order`/`Product` у `openapi/openapi.yaml`
(ДЗ #9). `pacts/marketplace-web-marketplace-api.json` закомічено, щоб контракт можна було
рев'ювити; CI генерує його заново. `verify:provider` піднімає застосунок на випадковому порту,
`stateHandlers` сідять БД через `INSERT … ON CONFLICT DO NOTHING`. Якщо `PACT_BROKER_URL` задано,
контракт береться з брокера і результат публікується (`publishVerificationResult: true`), якщо ні,
перевіряється локальний `pacts/*.json`.

### Брокер локально

`docker compose up -d --wait` піднімає й `pact-broker` (`:9292`, sqlite, healthcheck на
`127.0.0.1`). Адреса й токен брокера — секрети: код читає лише `process.env.PACT_BROKER_URL` /
`PACT_BROKER_TOKEN`. Локально вони приходять зі сховища ДЗ #11 тією самою обгорткою, у CI — з
GitHub secrets (якщо секрету `PACT_BROKER_URL` нема, job піднімає брокер із compose).

```bash
bash scripts/with-secrets.sh dev npm run verify:provider
PACT_BROKER_URL=http://127.0.0.1:9292 npm run verify:provider
```

Перший рядок — основний шлях (значення зі сховища). Другий — аварійна форма для грейдера без
доступу до сховища; під `SKIP_VAULT=1` обгортка виконує рівно її.

Допоміжні скрипти: `scripts/pact-publish.sh` (PUT контракту), `scripts/can-i-deploy.sh`
(`to <tag>` або `with <pacticipant> <version>`; exit 1, якщо `deployable` не `true`),
`scripts/pact-tag.sh` (тег версії).

### CI: job `contract`

`.github/workflows/ci.yml`: `test:contract` → publish → `verify:provider` з публікацією
результату → `can-i-deploy` (consumer@sha × provider@sha; job падає, якщо `deployable` ≠ `true`) →
на push у `main` тег провайдера `prod`.

### Гейт у роботі

Версія консюмера й провайдера — `V=$(git rev-parse --short HEAD)` (у моєму прогоні `3332bb3`).

```bash
docker compose up -d --wait
export PACT_BROKER_URL=http://127.0.0.1:9292 V=$(git rev-parse --short HEAD)
npm run test:contract
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT "$PACT_BROKER_URL/pacts/provider/marketplace-api/consumer/marketplace-web/version/$V" \
  -H 'Content-Type: application/json' --data-binary @pacts/marketplace-web-marketplace-api.json   # 201
PACT_PROVIDER_VERSION=$V npm run verify:provider                                                   # exit 0
curl -sS "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-web&version=$V&to=prod"            # до тега
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT "$PACT_BROKER_URL/pacticipants/marketplace-api/versions/$V/tags/prod" \
  -H 'Content-Type: application/json'                                                              # 201
curl -sS "$PACT_BROKER_URL/can-i-deploy?pacticipant=marketplace-web&version=$V&to=prod"            # після тега
```

`can-i-deploy` **до** тега `prod` (поле `summary` відповіді):

```json
{"deployable":null,"reason":"There is no verified pact between version 3332bb3 of marketplace-web and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}
```

`can-i-deploy` **після** тега `prod`:

```json
{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}
```

---

## Data layer ops (ДЗ #15)

```
застосунок / скрипти ──► pgbouncer:6432 (transaction pool, 10 серверних зʼєднань) ──► db:5432
backup.sh ──► pg_dump -Fc напряму в db ──► backups/marketplace_YYYY-MM-DD_HHMMSS.dump
restore-drill.sh ──► новий контейнер + новий volume ──► pg_restore ──► MATCH / exit 1
```

| Файл | Призначення |
|------|-------------|
| `pgbouncer/pgbouncer.ini` | `pool_mode = transaction`, `default_pool_size = 10`, `max_client_conn = 200`, `admin_users = admin`, `max_prepared_statements = 200` |
| `pgbouncer/userlist.txt` | лише дев-пароль `admin` (той самий, що в compose); решту юзерів PgBouncer бере з `pg_shadow` через `auth_query` |
| `scripts/backup.sh` | `pg_dump -Fc` → `backups/<db>_<дата>_<час>.dump`, перевіряє TOC через `pg_restore --list`, друкує шлях |
| `scripts/restore-drill.sh` | останній дамп → чистий контейнер і volume → контрольні значення до/після → `MATCH` |
| `backup.cron` | щоночі о 03:00 |
| `RESTORE-DRILL.md` | протокол drill-у: дата, розмір, час, RTO/RPO |

**Підняти.** `docker compose up -d --wait` піднімає `db` і `pgbouncer` (порт `6432` опублікований
на хост). Рядок підключення у сховищі (оточення `dev`/`prod`) і контракт у `.env.example` вказують
на `:6432`. `auth_query` потрібен, щоб ротація пароля `appuser` (`bash rotate.sh`) працювала й далі
без правок `userlist.txt`.

**Бекап.** `bash scripts/with-secrets.sh dev bash scripts/backup.sh`. Користувач/пароль/база
беруться з `$DATABASE_URL`, але сам `pg_dump` іде напряму в Postgres (`docker compose exec db`),
повз пулер: `pg_dump` виставляє session-level параметри до своєї транзакції, а transaction mode
не гарантує, що наступні запити підуть у те саме серверне зʼєднання. Destination — локальна тека
`backups/` поза контейнером (у `.gitignore`); `BACKUP_DIR=…` перевизначає її. Дамп пишеться
у `*.partial` і перейменовується тільки після успішної перевірки TOC, тож drill ніколи не візьме
обірваний файл.

**Відновитись.** `bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh` — це водночас і
процедура відновлення: скрипт створює чистий `postgres:16-alpine` з порожнім volume,
робить `pg_restore --no-owner --no-acl --exit-on-error` і звіряє кількість рядків у кожній таблиці +
`count|sum(total)` по `orders` з живою базою. На справжньому інциденті після `MATCH` перемикаємо
`[databases]` у `pgbouncer.ini` (або `DATABASE_URL` у сховищі) на відновлений інстанс.
Числа drill-у — у [`RESTORE-DRILL.md`](RESTORE-DRILL.md).

**Чому transaction mode.** Серверне зʼєднання Postgres — це окремий процес із кількома МБ памʼяті,
тож тисячі клієнтів (кілька інстансів застосунку × `poolSize` TypeORM) не можна тримати напряму.
У transaction mode серверне зʼєднання видається клієнту лише на час транзакції, тому 200 клієнтів
обслуговують 10 серверних зʼєднань. Ціна — все, що живе довше за транзакцію, ламається:
**(1)** session-level `SET` (`search_path`, `statement_timeout`) «протікає» в чуже зʼєднання або губиться —
тільки `SET LOCAL` усередині транзакції; **(2)** session-level advisory locks (`pg_advisory_lock`)
можуть лишитися висіти на зʼєднанні, яке вже обслуговує іншого клієнта — тільки `pg_advisory_xact_lock`;
**(3)** `LISTEN/NOTIFY` не працює — підписка привʼязана до сесії; **(4)** іменовані prepared statements
(`PREPARE`, protocol-level) жили лише в одному серверному зʼєднанні — тут закрито
`max_prepared_statements = 200` (PgBouncer ≥ 1.21), а `pg`/TypeORM і так шлють unnamed statements;
**(5)** `WITH HOLD`-курсори й тимчасові таблиці між транзакціями. Код курсового нічого з цього не
використовує (checkout, `SKIP LOCKED`-воркери й retry — усе в межах однієї транзакції), тому
міграції, seed і всі демо ДЗ #14 проходять через PgBouncer без змін.

---

## Конкурентність (ДЗ #14)

Ключова операція `checkout` (`src/checkout.ts`) виконується в одній транзакції: атомарний
декремент stock → списання балансу → INSERT замовлення + позиції → INSERT задачі на
post-processing. Брак товару або коштів → відкат цілої транзакції (замовлень-«сиріт» немає).

| Демо | Команда | Числа з моїх запусків |
|------|---------|------------------------|
| Гонка без oversell | `npm run demo:race` | 50 спроб → **10 успішних**, фінальний stock **0**, рядків із stock<0 — **0** |
| Воркер-пул (SKIP LOCKED) | `npm run demo:workers` | 24 задачі / 3 воркери → **8/8/8**, оброблено двічі **0**, **389 ms** проти 960 ms послідовно |
| Retry на serialization failure | `npm run demo:retry` | спіймано **1× `40001`** із повтором, фінальний balance **1200** (= 1000 + 2×100) |

*(числа від запуску до запуску трохи «пливуть» — `random()` у backoff і планувальник; інваріанти сталі.)*

### Pessimistic lock vs атомарний UPDATE

Для checkout обрано **атомарний `UPDATE products SET stock = stock - n WHERE id = … AND stock >= n
RETURNING`**, а не `SELECT … FOR UPDATE` + окремий UPDATE. Один statement поєднує перевірку, лок і
запис — немає вікна між читанням і записом і немає read-modify-write у JS; повернуті 0 рядків
означають «товару нема» — це і є перевірка, і лок водночас. `FOR UPDATE` тут коштував би зайвого
раунд-тріпа з утриманням локу через застосунок. `FOR UPDATE SKIP LOCKED` натомість використано у
воркері (`src/demo-workers.ts`), бо там задача — **захопити вільний рядок черги**, а не умовно
списати лічильник.

### Чому retry ловить лише два коди

Обгортка повторює транзакцію тільки на `40001` (serialization_failure) і `40P01`
(deadlock_detected) — це єдині **транзиторні** помилки, де повтор тієї самої транзакції має шанс
пройти: Postgres прямо каже «ти програв конкурентну гонку, спробуй ще раз». Будь-яка інша помилка
(порушення constraint, брак коштів, синтаксис, обрив зʼєднання) детермінована або бізнесова —
повтор або впаде так само, або задвоїть побічний ефект. Тому ловимо саме два коди, а не `catch (e)`.

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
`docker-compose.yml` (вони не секрет), а обгортка секретів пропускається через `SKIP_VAULT=1`.
Застосунок і скрипти ходять у базу **через PgBouncer** (порт `6432`), не напряму в Postgres:

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
```

`DataSource` читає `DATABASE_URL` (а якщо його нема — окремі `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`),
тож замість рядка вище можна експортувати й дискретні змінні:

```bash
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
```

Далі — стандартний конвеєр (ДЗ #13 + демо конкурентності ДЗ #14):

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
npm run demo:race
npm run demo:workers
npm run demo:retry
```

Бекап і restore-drill (ДЗ #15). Обидва скрипти читають `$DATABASE_URL` з оточення; під
`SKIP_VAULT=1` обгортка просто виконує `bash scripts/…`, тож досить `export` вище:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Перевірки PgBouncer (потрібен `psql` на хості, пароль — `admin-bootstrap-only`):

```bash
psql -h 127.0.0.1 -p 6432 -U admin -d marketplace -c "SELECT 1"
psql -h 127.0.0.1 -p 6432 -U admin -d pgbouncer -c "SHOW POOLS"
```

Тести (ДЗ #16). Потрібен лише запущений Docker; `DATABASE_URL` тестам не потрібен — його видає
testcontainer. Для кроку з брокером — аварійна форма без сховища:

```bash
npm run test:integration && npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
PACT_BROKER_URL=http://127.0.0.1:9292 npm run verify:provider
```

Повна послідовність гейта `can-i-deploy` — у [«Гейт у роботі»](#гейт-у-роботі).

Realtime (ДЗ #18): застосунок піднімається командами з [«Запуск і демо»](#запуск-і-демо)
(`DB_URL` — дев-креденшели compose через PgBouncer), далі:

```bash
curl -sN --max-time 2 -D - -o /dev/null http://localhost:3000/orders/1/events | grep -i '^content-type'
node scripts/realtime-demo.mjs; echo "exit=$?"
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"
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
