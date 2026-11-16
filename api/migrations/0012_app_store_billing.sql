-- App Store subscriptions (src/routes/billing.ts): one row per original transaction, its product.
ALTER TABLE subscriptions ADD COLUMN external_id TEXT;
ALTER TABLE subscriptions ADD COLUMN product_id TEXT;
CREATE UNIQUE INDEX subscriptions_external ON subscriptions (source, external_id) WHERE external_id IS NOT NULL;
