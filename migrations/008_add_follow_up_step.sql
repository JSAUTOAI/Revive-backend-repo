-- Migration 008: Add follow-up step tracking
-- Purpose: Track which automated follow-up message has been sent to each lead
-- Run in Supabase SQL Editor

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS follow_up_step INTEGER DEFAULT 0;

COMMENT ON COLUMN quotes.follow_up_step IS 'Follow-up sequence step: 0=none sent, 1=first follow-up sent (day 3), 2=second follow-up sent (day 7)';

-- Partial index for scheduler query - only care about incomplete sequences on new quotes
CREATE INDEX IF NOT EXISTS idx_quotes_follow_up_step
  ON quotes(follow_up_step) WHERE follow_up_step < 2 AND status = 'new';
