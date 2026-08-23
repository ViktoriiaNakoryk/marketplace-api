# Marketplace API — ДЗ #1 (контракт-first)

## Варіант: Б — runtime-валідація (express-openapi-validator)

## Встановлення
npm install

## Запуск сервера
npm start        # http://localhost:3000

## Перевірка спеки
npm run lint

## Перевірка сервера (3 запити)
curl -i -X POST http://localhost:3000/orders -H "Content-Type: application/json" -d '{"items":[{}]}'
Очікуємо: HTTP/1.1 400 Bad Request, "request/headers must have required property 'idempotency-key'"

curl -i -X POST http://localhost:3000/orders -H "Content-Type: application/json" -H "Idempotency-Key: abc-123" -d '{"items":[]}'
Очікуємо: HTTP/1.1 400 Bad Request, "request/body/items must NOT have fewer than 1 items"

curl -i -X POST http://localhost:3000/orders -H "Content-Type: application/json" -H "Idempotency-Key: abc-123" -d '{"items":[{"product_id":1}]}'
Очікуємо: HTTP/1.1 201 Created