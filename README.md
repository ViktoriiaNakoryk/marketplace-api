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
| `REDIS_URL`        | кеш-інстанс Redis (`allkeys-lru`), compose `:6390`                 | —                     | **сховище секретів (ДЗ #11)** |
| `REDIS_QUEUE_URL`  | інстанс під BullMQ, сесії й rate-limit (`noeviction` + AOF), `:6391` | —                   | **сховище секретів (ДЗ #11)** |

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

## Redis: кеш, сесії, ліміти, черга (ДЗ #23)

Redis тут не робить систему правильною — він робить її швидкою. Усе, що лежить у ньому, або
можна перерахувати з Postgres (кеш), або втратити без зіпсованого стану (сесія → перелогін,
лічильник ліміту → один зайвий запит, задача в черзі → вона ідемпотентна за `jobId`).

### Два інстанси і чому саме два

| Сервіс compose | Порт хоста | Політика | Що лежить |
|----------------|-----------|----------|-----------|
| `redis-cache`  | `6390`    | `maxmemory 64mb`, `maxmemory-policy allkeys-lru`, без персистентності | cache-aside картки товару (`REDIS_URL`) |
| `redis-queue`  | `6391`    | `maxmemory 256mb`, `maxmemory-policy noeviction`, `appendonly yes` + `appendfsync everysec` | BullMQ, сесії, лічильники rate-limit (`REDIS_QUEUE_URL`) |

**Чому два:** кешу потрібен `allkeys-lru` (переповнився — викинь старе), а BullMQ потребує
`noeviction` (витіснений ключ черги = загублена або зламана задача). `maxmemory-policy` одна на
весь процес Redis — `SELECT 1` її не розводить, тому це два контейнери, а не дві бази в одному.

**Сесії й ліміти — у `redis-queue`, не в кеші.** На `allkeys-lru` сесію колись викине LRU, і
користувача розлогінить без жодної причини, яку можна відтворити. Третій інстанс під сесії для
курсового — зайва коробка: `redis-queue` уже має `noeviction` і AOF, тобто сесія переживе і тиск
памʼяті, і рестарт Redis. Лічильники ліміту туди ж: вони дрібні, з TTL, і їхнє витіснення
означало б мовчазне скидання ліміту.

Обидва URL приходять зі сховища ДЗ #11 (оточення `dev`), так само як `DATABASE_URL`; у
`.env.example` — лише плейсхолдери, нових env-файлів немає.

### Що де в коді

- **Cache-aside** — `src/products/product-card.cache.ts`, ендпоінт `GET /products/:id/card`.
  Картка = товар + продавець + агрегати по `order_items` (продано штук, замовлень, виручка) —
  `JOIN` + `LATERAL`-агрегат, найдорожче читання каталогу (`ProductsRepository.findCard`).
  TTL ставиться завжди: `300 + randomInt(0..60)` секунд; `null` кешується на 30 с, щоб не
  довбати базу неіснуючими id. Помилка запису/читання Redis (OOM, розрив) не валить запит —
  ідемо в базу. `invalidate(id)` — додатково до TTL, не замість.
- **Single-flight лок** — `src/redis/lock.ts`: `SET lock:<key> <uuid> NX PX 5000`, знімається
  тільки Lua compare-and-delete (`redis:7.4` — `DELEX` ще немає). Переможець після взяття лока
  ще раз читає кеш (double-check), решта кожні 20 мс перечитують кеш; якщо за 3 с нічого не
  зʼявилось — ідуть у базу самі (деградація, а не зависання).
- **Сесії** — `src/sessions/session.store.ts`: JSON під `sess:<id>`, кука `sid` (HttpOnly,
  SameSite=Lax). Кожен запит читає сесію через `GETEX … EX 1800` — читання і продовження TTL
  однією атомарною командою (rolling TTL). Готово під ДЗ #24 (auth).
- **Rate-limit** — `src/rate-limit/sliding-window.limiter.ts`, глобальний middleware у `main.ts`
  (100 запитів / 60 с на IP, вмикається, коли є `REDIS_QUEUE_URL`). Модель — **ковзне вікно
  (лог у ZSET)**, бо сплеск ми **не** дозволяємо: фіксоване вікно пропускає до 2× ліміту на межі
  хвилин, а token bucket свідомо дозволяє burst. Перевірка і запис — один Lua-скрипт
  (`ZREMRANGEBYSCORE` → `ZCARD` → `ZADD`), час береться з `TIME` самого Redis, тож поди з різним
  годинником ділять одне вікно. Тут атомарність — вимога коректності: між `ZCARD` і `ZADD`
  інший под устиг би пролізти. Перевищення → `429` + `Retry-After` (секунди до виходу
  найстаршого запиту з вікна). Якщо Redis недоступний — fail-open (ліміт — захист, а не бізнес-інваріант).
- **Черга BullMQ** — `src/queue/notifications.queue.ts`, воркер `npm run worker`
  (`src/worker.ts`). Задачі: лист-підтвердження замовлення (`jobId = order-confirmation-<orderId>` —
  та сама подія `order.placed` з ДЗ #22, повторна доставка не породить другий лист) і
  планувальник `product-stats-refresh` через `upsertJobScheduler` (раз на 5 хв; upsert — тож
  рестарт не плодить дублікатів). `attempts: 5`, `backoff: { type: 'exponential', delay: 1000, jitter: 0.5 }`,
  `removeOnComplete: { age: 86400, count: 10000 }` — **не** `true`, бо `true` вимикає дедуплікацію за
  `jobId`. Воркер ходить через окреме зʼєднання з `maxRetriesPerRequest: null` (чекає Redis, а не
  падає), `Queue` — зі стандартним (падає швидко).

### Демо і мої числа

Усі чотири демо самоочисні (видаляють свої ключі, товари, сесію, чергу) — після прогону обидва
інстанси мають `DBSIZE 0`. `db-calls` рахує `CountingQueryable` — обгортка над `pg.Pool`, яка
лічить кожен реальний запит до Postgres, а не виклики функції кешу.

```bash
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
```

| Демо | Результат прогону |
|------|-------------------|
| `demo:cache` | `cache-lru=1 cache-maxmemory=1` (allkeys-lru, 64 MiB); `warmed=60`, TTL у діапазоні 302..360 с, `ttl-distinct=40`; `concurrent=25` на щойно видалений ключ → `db-calls=1` за 22 мс; наступні 100 читань → `db-calls-warm=0`; чужий токен лок не знімає (`lock-foreign-release=0`), свій — знімає |
| `demo:session` | `requests=4` (останній — після «рестарту»: новий сервер і нове зʼєднання з Redis), `sessions=1`, `in-redis=1`; PTTL 1 797 998 мс до активності → 1 799 998 мс після, `ttl-renewed=1` |
| `demo:ratelimit` | `instances=2` (два HTTP-сервери, кожен зі своїм зʼєднанням і лімітером), `limit=5`, `requests=12` по черзі між подами → `allowed=5 blocked=7 status=429`, `Retry-After: 10`, `retry-after=1` |
| `demo:queue` | `queue-noeviction=1`; вебхук двічі віддає 503 → `attempts=3`, `completed=1` за 348 мс; два `add` з одним `jobId` → `added=2 queued=1`; два `upsertJobScheduler` з одним id → `schedulers=1`; за 3 с при `every: 500` → `scheduled-runs=6` |

### Що станеться, якщо stampede-лок зламається — і чому тут це прийнятно

Лок може «зламатися» трьома способами: процес-переможець завис довше за `PX 5000` (GC, page fault,
переїзд контейнера) і лок протух; Redis перезапустився й забув лок; або хтось зняв лок голим
`DEL`. В усіх випадках наслідок однаковий — **кілька запитів одночасно вирішать, що лок у них, і
підуть у базу**: замість одного `SELECT` буде два чи двадцять п'ять, і вони однаковими значеннями
перезапишуть один і той самий ключ кешу. Жодного зіпсованого стану: картка товару — це
read-only проєкція Postgres, а `SET … EX` ідемпотентний. Ціна поломки — кілька зайвих читань і
трохи CPU бази, а не гроші чи дані. Тому тут вистачає одного Redis, `SET NX PX` і
compare-and-delete без fencing-токенів, Redlock і перевірок «а чи мій ще лок». Бізнес-інваріанти
(залишок на складі, баланс, «одне замовлення на ключ ідемпотентності») цей лок **не захищає** —
їх і далі тримають транзакції, атомарний `UPDATE … WHERE stock >= $n` та унікальні індекси з ДЗ #14/#22,
бо там поломка лока означала б продати товар двічі.

---

## Outbox та ідемпотентність (ДЗ #22)

Спільного `COMMIT` між Postgres і RabbitMQ не існує, тож оформлення замовлення більше не публікує
в брокер саме. Воно пише подію в таблицю `outbox` **тією самою транзакцією**, що й замовлення, а
назовні її виносить окремий процес-relay. Платимо за це at-least-once доставкою, тому ефект у
споживача ідемпотентний на трьох рівнях.

```
POST /orders + Idempotency-Key
  └─ BEGIN ─ INSERT idempotency_keys … ON CONFLICT DO NOTHING      (рівень 3: API-край)
            INSERT orders + order_items                           (бізнес-запис)
            INSERT outbox (id=eventId, payload=toOrderPlacedEvent) (подія)
     COMMIT ─ один pool.connect()-клієнт, одна транзакція

relay (npm run relay, окремий процес)
  └─ BEGIN ─ SELECT … FROM outbox WHERE published_at IS NULL ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED LIMIT 50
            для кожного: publish (confirm) ─► UPDATE published_at = now()
     COMMIT

consumer (npm run consumer)
  └─ BEGIN ─ INSERT processed_messages (message_id, consumer) ON CONFLICT DO NOTHING   (рівень 2: inbox)
            INSERT fulfillments … ON CONFLICT DO NOTHING                              (рівень 1: природний ключ)
     COMMIT ─► ack
```

| Файл | Що там |
|------|--------|
| `src/migrations/*-AddOutboxInboxIdempotency.ts` | `outbox` + частковий індекс `WHERE published_at IS NULL`, `processed_messages`, `idempotency_keys` |
| `src/orders/orders.service.ts` | `placeOrder`: ключ ідемпотентності + замовлення + outbox одним `COMMIT` |
| `src/outbox/outbox-relay.ts`, `src/relay.ts` | relay-воркер на polling: `FOR UPDATE SKIP LOCKED` → publish → `UPDATE published_at` |
| `src/fulfillment/fulfillments.repository.ts` | ефект + позначка в `processed_messages` в одній транзакції |
| `src/demos/demo-outbox.ts`, `demo-crash-write.ts`, `demo-crash-relay.ts` | три самоочисні демо |

**Таблиця `outbox`** (міграцією, не `synchronize`): `id uuid` (він же `eventId`), `aggregatetype`,
`aggregateid`, `type`, `payload jsonb`, `created_at`, `published_at` (`NULL` = ще не винесено),
`attempts`, `last_error`. `aggregatetype`/`aggregateid` названо канонічно для Debezium Outbox Event
Router: `aggregatetype` — дефолтний `route.by.field`, `aggregateid` — ключ повідомлення, `id` —
ідентифікатор події. Перехід на CDC не переписує консюмерів; `created_at`/`published_at`/`attempts`
потрібні лише polling-relay. Під relay стоїть частковий індекс
`(created_at, id) WHERE published_at IS NULL`: він містить лише невинесені рядки, тож лишається
крихітним, хоч би як виросла таблиця.

**Контракт події.** У `payload` іде результат явної функції `toOrderPlacedEvent(order, eventId)`
(`eventId`, `type`, `version`, `occurredAt`, `data`), а не ORM-сутність, тож перейменування колонки
в БД не ламає консюмерів.

**Relay.** Саме `FOR UPDATE SKIP LOCKED`: два relay-и паралельно беруть різні рядки, а не стоять у
черзі на один лок (голий `FOR UPDATE` дав би 0 дублів ціною нуля паралельності). Транзакція з локами
тримається, поки публікується пачка, і `UPDATE published_at` іде після confirm-у кожної події.
Невдала публікація інкрементує `attempts` і пише `last_error`, рядок лишається `NULL` і буде
повторений наступним циклом. Курсор `id > last` тут не годиться: UUID не впорядкований, а
`bigserial` видає номер на `nextval`, видимим же рядок стає на `COMMIT`, тож курсор пропускав би
рядки. (Видно навіть у демо: невдала транзакція `demo:crash-write` спалила `orders.id = 11`, і
наступне замовлення отримало `12`.) **Порядок доставки не гарантується:** `ORDER BY created_at, id`
задає лише порядок вибірки, а `SKIP LOCKED` розкидає рядки між воркерами. Для `fulfillment` порядок
не потрібен (кожна подія — окреме замовлення). Якщо колись знадобиться порядок у межах замовлення,
його дасть лише партиціонування за `aggregateid`.

**Чистка outbox.** Винесені рядки потрібні тільки для аудиту, тож план такий: нічна задача
`DELETE FROM outbox WHERE published_at < now() - interval '7 days'` пачками по 10k, а при великих
обсягах — партиціонування `outbox` за `created_at` і `DROP PARTITION` замість `DELETE`. Частковий
індекс від цього не залежить, але чистка тримає під контролем bloat і розмір таблиці.

**Ідемпотентність — три рівні.**

1. **Природний ключ (ефект).** `INSERT INTO fulfillments … ON CONFLICT DO NOTHING`, де `orderId` і
   `eventId` унікальні. Повтор нічого не змінює, на відміну від `UPDATE qty = qty - 1`.
2. **Inbox.** `processed_messages (message_id, consumer)` з PK на обидва поля. Позначка й ефект
   комітяться **однією транзакцією** на одному клієнті: падіння між ними відкочує обидва, тож «позначено,
   а ефекту нема» неможливе. Позначка живе в тій самій Postgres, що й ефект, а не в Redis/памʼяті.
3. **API-край.** `POST /orders` вимагає `Idempotency-Key` (з ДЗ #9), тепер із серверною механікою:
   `INSERT INTO idempotency_keys … ON CONFLICT DO NOTHING` у тій самій транзакції, що й замовлення.
   Другий запит з тим самим ключем повертає те саме замовлення з `201` і заголовком
   `Idempotent-Replayed: true`. Конкурентний дубль чекає на unique-індексі, поки перший не закомітить,
   і потім отримує replay. Ключ ідентифікує **намір**, а не тіло: два однакові тіла з різними ключами —
   два легітимні замовлення. Хеш тіла (`request_fingerprint`) зберігається лише для захисту від
   помилки клієнта: той самий ключ з іншим тілом → `422`.

### Чому не можна поміняти місцями publish і UPDATE published_at

Бо вибір тут між дублем і втратою. Порядок `publish → UPDATE`: якщо relay помре між ними, рядок
лишиться `published_at IS NULL`, і наступний цикл опублікує подію вдруге. Це дубль, а дубль лікується
дедупом на споживачі. Порядок `UPDATE → publish`: якщо relay помре (або publish впаде) після
`UPDATE`, рядок уже позначено винесеним, а в брокер нічого не пішло, і ніхто його більше не
підбере. Це втрата, а її не лікує нічого. До того ж помилка publish не означає «не доставлено»:
загубитись могла лише відповідь брокера. Тому дедуп на споживачі обовʼязковий за будь-якого порядку,
а правильний порядок — той, що зводить усі збої до дублів. Звідси формула: **at-least-once доставка +
ідемпотентний ефект = exactly-once результат**. Exactly-once доставки не дає ні RabbitMQ, ні relay.

### Демо

Кожне демо проганяє міграції, оголошує топологію, виносить застарілі рядки outbox і чистить
черги, заводить власних покупця/товар, запускає споживача (і в `crash-relay` — relay) **окремими
дочірніми процесами**, друкує `ключ=число` і повертає `1`, якщо інваріант порушено. Перед запуском
зупини `npm run consumer` / `npm run relay`, якщо вони працюють.

```bash
npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay
```

**`demo:outbox`** — демо піднімає застосунок на випадковому порту і шле **два конкурентні**
`POST /orders` з одним `Idempotency-Key`, далі relay, далі споживач:

```
# 2 concurrent POST /orders with Idempotency-Key …: 201, 201 (replayed) → order id(s) 10
requests=2
created=2
replayed=1
orders=1
outbox=1
outbox-pending-before-relay=1
published=1
deliveries=1
effect=1
processed=1
fulfillment-rows=1
```

**`demo:crash-write`** — фейл бізнес-запису **змодельовано винятком** у тій самій транзакції, вже
після `INSERT` в outbox і перед `COMMIT` (хук `afterOutboxWrite` у `placeOrder`). Усередині транзакції
рядок outbox видно (`outbox-inside-tx=1`), а після падіння зникли і він, і замовлення, і ключ:

```
write-failed=1
outbox-inside-tx=1
orders=0
outbox=0
idempotency-keys=0
published=0
deliveries=0
effect=0
```

**`demo:crash-relay`** ⭐ — **справжній `kill -9`**: перший relay-процес запущено з
`DEMO_CRASH_AFTER_PUBLISH=1`, він публікує подію і вбиває себе `SIGKILL` рівно між publish і
`UPDATE published_at`. Його транзакція не закомічена, тож рядок лишається `published_at IS NULL`, а
лок звільняється разом з обірваним зʼєднанням. Другий relay публікує ту саму подію вдруге і
комітить. Споживач отримує дві доставки: перша застосовує ефект, другу відсікає `processed_messages`:

```
published=2
deliveries=2
applied=1
duplicates=1
effect=1
processed=1
outbox-pending=0
work=0
dlq=0
```

**Секрети.** Підключення до бази й `BROKER_URL` — зі сховища ДЗ #11. Усі три демо, `npm run relay`
і `npm run consumer` запускаються через `bash scripts/with-secrets.sh dev …`.

---

## Async-події через RabbitMQ (ДЗ #19)

Між оформленням замовлення і тими, хто на нього реагує, тепер стоїть брокер, який зберігає подію,
поки споживач не підтвердить обробку. Брокер — RabbitMQ `4.2.9-management` (LTS-серія 4.2,
підтримка до 30.06.2030) у `docker-compose.yml`, healthcheck — `rabbitmq-diagnostics -q check_running`.
Менеджмент-морда — http://localhost:15672 (`app` / `app`, дев-креденшели).

```
POST /orders ─► OrdersService.placeOrder ─► INSERT orders/order_items + outbox (один COMMIT, ДЗ #22)
                                                       │
           relay (npm run relay) ─► confirm-канал: publish shop.events  [order.placed]  ─► waitForConfirms
                                     │ (alternate-exchange → shop.events.unrouted, якщо binding не збігся)
                                     ▼
                     fulfillment.order-placed  (quorum, x-delivery-limit=5, x-dead-letter-exchange)
                                     │ reject(requeue=false) / delivery-limit
                                     ▼
                     shop.events.dlx ─► fulfillment.order-placed.dlq
```

| Файл | Що там |
|------|--------|
| `src/messaging/topology.ts` | exchange `shop.events` (topic) + alternate exchange, черга, binding, DLX + DLQ |
| `src/messaging/order-placed.event.ts` | контракт події і його валідація на боці споживача |
| `src/messaging/event-publisher.ts` | confirm-канал (`createConfirmChannel` + `waitForConfirms`) |
| `src/orders/orders.service.ts` | `placeOrder`: бізнес-операція + рядок outbox (з ДЗ #22 публікує relay) |
| `src/messaging/order-placed.consumer.ts` | споживач: `noAck: false`, `prefetch`, ack після ефекту, reject → DLQ |
| `src/fulfillment/fulfillments.repository.ts` | ідемпотентний ефект: `INSERT … ON CONFLICT DO NOTHING` |
| `src/consumer.ts` | окремий процес споживача (`npm run consumer`) |
| `src/demos/*.ts` | три самоочисні демо |

**Топологію оголошує споживач, а не продюсер.** `assertTopology()` викликає споживач при старті
(і демо-обвʼязка як бутстрап-крок). Продюсер знає лише exchange `shop.events` і routing key
`order.placed`. Подію, на яку ще немає binding-у, ловить alternate exchange
`shop.events.unrouted`, тож позитивний confirm не означає мовчки викинутого повідомлення.

**Контракт події** — окремий тип, а не ORM-сутність через spread:

```json
{ "eventId": "7317db28-ab6b-422b-9e93-58a4f597ea31", "type": "order.placed", "version": 1, "occurredAt": "2026-10-10T15:38:59.355Z",
  "data": { "orderId": 42, "buyerId": 4, "total": 249900, "currency": "UAH",
            "items": [{ "productId": 1, "quantity": 1, "unitPrice": 249900 }] } }
```

`eventId` стабільний: з ДЗ #22 це `id` рядка outbox (UUID), який генерується один раз у транзакції
замовлення і лежить у `payload`. Скільки б разів relay не публікував подію, ідентифікатор той самий,
і споживач упізнає дубль. Він же йде в `messageId` AMQP-властивостей.

**Споживач.** `noAck: false`; `ack` — лише після того, як ефект закомічено в Postgres. Невалідна
подія (зламаний контракт) або порушення constraint класу `23xxx` — постійні помилки:
`reject(requeue=false)` → DLX → DLQ з причиною `rejected`. Будь-яка інша помилка (наприклад, база
недоступна) вважається транзиторною: `reject(requeue=true)`, і повторів не більше
`x-delivery-limit = 5` (quorum-черга), після чого повідомлення теж іде в DLQ з причиною
`delivery_limit`. Цей шлях налаштовано, але в демо показано лише `rejected`. Якщо брокер скасовує
споживача (`basic.cancel`, `msg === null`) або рве зʼєднання, процес завершується з кодом 1: нехай
його перезапустить супервізор, а не код шле `ack` у нікуди.

**prefetch = 20.** Ефект — один `INSERT` через PgBouncer, у моїх прогонах **5–11 мс** на подію
(`effect-avg-ms`). Отже `prefetch × час обробки = 20 × ~10 мс ≈ 0.2 с`, що на чотири порядки
менше за `consumer_timeout` = 30 хв (1800 с). Навіть якщо обробка сповільниться до 1 с, це 20 с.
При цьому 20, а не 0: другий екземпляр споживача отримає свою частку черги, а не простоюватиме,
поки перший забрав усе. І не 1, бо при обробці за мілісекунди `prefetch=1` змушує чекати
round-trip до брокера після кожного повідомлення.

**Ідемпотентність.** Ефект — «завести відправлення під замовлення»: рядок у `fulfillments` з
унікальними `eventId` та `orderId`. `INSERT … ON CONFLICT DO NOTHING RETURNING id` — природно
ідемпотентна операція: повторна доставка вставляє 0 рядків, споживач рахує це як `skipped` і просто
робить `ack`. Сховище дедупу — та сама таблиця в Postgres, тож воно переживає рестарт споживача й
спільне для будь-якої кількості реплік (жодного `Set` у памʼяті).

### Чому це at-least-once, а не exactly-once

RabbitMQ не гарантує, що повідомлення буде доставлене рівно один раз: такої гарантії доставки немає
ні в кого. Ack — це «я більше не вимагаю повтору», і він іде окремим кроком після ефекту. Якщо
процес падає між закомітженим ефектом і ack, брокер чесно віддає повідомлення ще раз. Тому доставка
в мене **at-least-once** (ручний ack після ефекту + `persistent` + quorum-черга + confirm-публікація),
а **exactly-once результат** дає ідемпотентний ефект: вставка за унікальним ключем `eventId`/`orderId`,
яка на дублі нічого не змінює. Довелося зробити дві речі: ack після ефекту (щоб не губити) і ефект,
безпечний для повтору (щоб не подвоювати).

Межі, які це ДЗ свідомо не закриває:

- **База і брокер не атомарні.** У ДЗ #19 `placeOrder` комітив замовлення, а потім публікував, і
  падіння між ними давало замовлення без події. **Закрито в ДЗ #22** transactional outbox-ом (див.
  [«Outbox та ідемпотентність»](#outbox-та-ідемпотентність-дз-22)).
- **Позначка «оброблено» і ефект.** У ДЗ #19 вони збігались (один рядок в одному `INSERT`). З ДЗ #22
  позначка в `processed_messages` і ефект комітяться однією транзакцією.
- **`dead-letter-strategy`.** Quorum-черга за замовчуванням dead-letter-ить в режимі `at-most-once`:
  якщо DLQ недоступна, повідомлення може загубитись. `at-least-once` вмикається політикою, але працює
  лише разом з `overflow: reject-publish`. Без нього брокер мовчки відкочується на `at-most-once`
  і пише про це лише в лог. Для ДЗ лишила дефолт.

### Демо

Кожне демо саме проганяє міграції, оголошує топологію, чистить робочу чергу й DLQ, заводить власних
покупця/товар, запускає споживача **окремим дочірнім процесом** (`dist/consumer.js`), друкує
підсумок рядками `ключ=значення` і завершується з кодом 1, якщо інваріант порушено. Перед запуском
зупини `npm run consumer`, якщо він працює: демо відмовиться стартувати, коли в черги вже є
споживач.

```bash
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
```

**`demo:publish`** — 5 замовлень через `OrdersService.placeOrder`; мій прогін:

```
published=5
delivered=5
effect=5
acked=5
work=0
dlq=0
prefetch=20
fulfillment-rows=5
effect-avg-ms=5.05
```

**`demo:dlq`** — у `shop.events` іде отруєне повідомлення з `data.orderId: "not-a-number"`
(імітація продюсера зі зламаним контрактом). Споживач робить `reject(requeue=false)`, повідомлення
опиняється в DLQ, а причину демо читає з `x-first-death-reason` / `x-death[0].reason`:

```
rejected=1
effect=0
work=0
dlq=1
dlq-reason=rejected
dlq-from-queue=fulfillment.order-placed
dlq-message-id=poison-1791646699346
```

**`demo:duplicate`** — повторна доставка через **справжній `kill -9`**. Перший дочірній споживач
запущений з `DEMO_CRASH_BEFORE_ACK=1`: він застосовує ефект і вбиває себе `SIGKILL` до ack. ОС
закриває сокет, брокер бачить обрив зʼєднання і повертає неacked повідомлення в чергу. Другий,
нормальний споживач отримує його з `redelivered=true`; `INSERT … ON CONFLICT` вставляє 0 рядків, і
він робить ack:

```
deliveries=2
effect=1
skipped=1
acked=1
redelivered=1
fulfillment-rows=1
work=0
dlq=0
```

Дві доставки, один ефект: at-least-once доставка + ідемпотентний ефект = exactly-once результат.

**Секрети.** `BROKER_URL` лежить у сховищі ДЗ #11 поруч із `DATABASE_URL`, а всі три демо й
`npm run consumer` запускаються через `bash scripts/with-secrets.sh dev …`. У `.env.example` —
лише плейсхолдер `amqp://USER:PASSWORD@localhost:5672`. З ДЗ #22 застосунок у брокер не ходить
узагалі: подію публікує окремий процес `npm run relay`.

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

Redis (ДЗ #23). Два інстанси з compose: кеш на `6390` (`allkeys-lru`), черга/сесії/ліміти на `6391`
(`noeviction`). Демо самі проганяють міграції, створюють і прибирають свої дані:

```bash
docker compose up -d --wait
export REDIS_URL=redis://127.0.0.1:6390
export REDIS_QUEUE_URL=redis://127.0.0.1:6391
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
npm ci
npx tsc --noEmit
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
```

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

Outbox (ДЗ #22). Брокер — RabbitMQ з compose (AMQP на `5672`), база — через PgBouncer. Демо самі
проганяють міграції, тож досить цих рядків:

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
npm ci
npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay
```

RabbitMQ (ДЗ #19). Брокер піднімається тим самим `docker compose up -d --wait` (AMQP на `5672`,
вебморда на `15672`). Демо самі проганяють міграції й чистять черги, тож досить цих рядків:

```bash
docker compose up -d --wait
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
npm ci
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
```

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
