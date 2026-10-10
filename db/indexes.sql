\set ON_ERROR_STOP on

CREATE INDEX idx_orders_buyer_created ON orders (buyer_id, created_at DESC);
CREATE INDEX idx_orders_pending ON orders (created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_products_lower_sku ON products (lower(sku));
CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
