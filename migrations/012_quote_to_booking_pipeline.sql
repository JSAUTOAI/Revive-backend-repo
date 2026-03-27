-- Migration 012: Quote-to-Booking Pipeline
-- Adds columns for the automated pipeline: photos -> AI pricing -> booking
-- Run this in Supabase SQL Editor

-- ─── Photo tracking ─────────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS photos_requested_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS photos_uploaded_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS photo_count integer DEFAULT 0;

-- ─── AI final pricing ───────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price numeric(10,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_confidence numeric(3,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_reasoning text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_ai_version text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_set_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_set_by text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_sent_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_admin_approved boolean DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_price_admin_approved_at timestamptz;

-- ─── Customer acceptance of final price ─────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_accepted_final_price boolean DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_accepted_final_price_at timestamptz;

-- ─── Booking fields ─────────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booking_offered_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booked_date date;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booked_time_slot text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booked_job_id uuid;

-- ─── Pipeline stage tracking ────────────────────────────────────────
-- Values: estimate_pending, estimate_sent, photos_requested, photos_uploaded,
--   final_price_pending_approval, final_price_sent, final_price_accepted,
--   booking_offered, booked
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'estimate_pending';

-- ─── Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quotes_pipeline_stage ON quotes(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_quotes_photos_pending ON quotes(photos_requested_at)
  WHERE photos_requested_at IS NOT NULL AND photos_uploaded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_final_price_pending ON quotes(final_price_set_at)
  WHERE final_price_admin_approved = false AND final_price_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_booking_offered ON quotes(booking_offered_at)
  WHERE pipeline_stage = 'booking_offered';

-- ─── Pipeline configuration in settings table ───────────────────────
-- Only insert if not already present
INSERT INTO settings (key, value)
SELECT 'pipeline_config', '{
  "pricing_mode": "ai_suggest_admin_approves",
  "confidence_threshold": 0.7,
  "photo_reminder_days": 2,
  "final_price_reminder_days": 3,
  "max_booking_slots_initial": 5,
  "booking_lookahead_weeks": 6,
  "max_jobs_per_day": 4,
  "honesty_clause": "This price is based on the information provided and access to the site. If conditions differ from what was described, any adjustments will be discussed before work begins."
}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'pipeline_config');
