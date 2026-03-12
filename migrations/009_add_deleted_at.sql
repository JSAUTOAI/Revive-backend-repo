-- Migration 009: Add soft delete for quotes
-- Purpose: Allow hiding test/unwanted quotes without permanently deleting them
-- Run in Supabase SQL Editor

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN quotes.deleted_at IS 'Soft delete timestamp — when set, quote is hidden from main views but can be restored';

-- Partial index: most queries only care about non-deleted quotes
CREATE INDEX IF NOT EXISTS idx_quotes_deleted_at ON quotes(deleted_at) WHERE deleted_at IS NULL;
