SELECT id, buyer_id, total, created_at
FROM orders
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 50
