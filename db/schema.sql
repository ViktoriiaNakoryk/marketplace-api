\set ON_ERROR_STOP on

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

CREATE TABLE users
(
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email      text        NOT NULL UNIQUE,
    full_name  text        NOT NULL,
    role       text        NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products
(
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id     bigint         NOT NULL REFERENCES users (id),
    sku           text           NOT NULL UNIQUE,
    name          text           NOT NULL,
    description   text           NOT NULL,
    category      text           NOT NULL,
    brand         text           NOT NULL,
    price         numeric(12, 2) NOT NULL CHECK (price > 0),
    created_at    timestamptz    NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED
);

CREATE TABLE orders
(
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    buyer_id   bigint         NOT NULL REFERENCES users (id),
    status     text           NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded')),
    total      numeric(12, 2) NOT NULL CHECK (total >= 0),
    created_at timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE order_items
(
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id   bigint         NOT NULL REFERENCES orders (id),
    product_id bigint         NOT NULL REFERENCES products (id),
    quantity   integer        NOT NULL CHECK (quantity > 0),
    unit_price numeric(12, 2) NOT NULL CHECK (unit_price > 0)
);
