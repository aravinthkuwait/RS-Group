-- v5: trigram indexes so drug-name / customer-name-or-mobile ILIKE '%q%'
-- search can use a GIN index instead of a full table scan.
SET search_path TO rsgroup;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_medicines_name_trgm ON medicines USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medicines_generic_trgm ON medicines USING gin (generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medicines_brand_trgm ON medicines USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medicines_category_trgm ON medicines USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_batches_batch_no ON stock_batches(batch_no);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);
