-- Migration 002: Add Estimation, Lead Scoring, and Tracking Columns
-- Purpose: Prepare database for automated estimation, lead qualification, and admin workflow
-- Safe to run: All columns are nullable or have defaults, won't break existing data
-- Created: 2026-02-12

-- ==========================================
-- STEP 1: Add Estimation & Lead Scoring Columns
-- ==========================================

-- Financial estimates (in GBP)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS estimated_value_min NUMERIC(10,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS estimated_value_max NUMERIC(10,2);

-- Lead qualification metrics
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lead_score INTEGER;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS qualification_status TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS conversion_likelihood NUMERIC(3,2);

-- Track estimation metadata
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS estimation_engine_version TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS estimated_at TIMESTAMPTZ;

COMMENT ON COLUMN quotes.estimated_value_min IS 'Minimum estimated quote value in GBP (e.g., 150.00)';
COMMENT ON COLUMN quotes.estimated_value_max IS 'Maximum estimated quote value in GBP (e.g., 300.00)';
COMMENT ON COLUMN quotes.lead_score IS 'Lead quality score 0-100 (higher = better quality)';
COMMENT ON COLUMN quotes.qualification_status IS 'Lead temperature: hot, warm, cold, unqualified';
COMMENT ON COLUMN quotes.conversion_likelihood IS 'Probability of conversion 0.00-1.00 (e.g., 0.75 = 75%)';
COMMENT ON COLUMN quotes.estimation_engine_version IS 'Version of estimation rules used (e.g., v1.0, v2.0)';
COMMENT ON COLUMN quotes.estimated_at IS 'Timestamp when estimate was calculated';

-- ==========================================
-- STEP 2: Add Communication Tracking Columns
-- ==========================================

-- Email tracking
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS estimate_email_sent_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;

-- WhatsApp tracking (for Phase 8)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN quotes.confirmation_email_sent_at IS 'When confirmation email was sent to customer';
COMMENT ON COLUMN quotes.estimate_email_sent_at IS 'When estimate email was sent to customer';
COMMENT ON COLUMN quotes.last_contact_at IS 'Last time we contacted this customer';
COMMENT ON COLUMN quotes.next_follow_up_at IS 'When this lead should be followed up next';
COMMENT ON COLUMN quotes.whatsapp_sent_at IS 'When WhatsApp message was sent (Phase 8)';

-- ==========================================
-- STEP 3: Add Admin Workflow Columns
-- ==========================================

-- Admin management
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS internal_priority TEXT;

COMMENT ON COLUMN quotes.assigned_to IS 'User ID or name of person assigned to this lead';
COMMENT ON COLUMN quotes.admin_notes IS 'Free-form notes for internal use only';
COMMENT ON COLUMN quotes.internal_priority IS 'Internal priority: high, medium, low';

-- ==========================================
-- STEP 4: Add Conversion Tracking Columns
-- ==========================================

-- Sales pipeline tracking
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS final_value NUMERIC(10,2);

COMMENT ON COLUMN quotes.quoted_at IS 'When formal quote was sent to customer';
COMMENT ON COLUMN quotes.booked_at IS 'When job was confirmed/booked';
COMMENT ON COLUMN quotes.completed_at IS 'When job was completed';
COMMENT ON COLUMN quotes.final_value IS 'Actual final invoice amount in GBP';

-- ==========================================
-- STEP 5: Create Performance Indexes
-- ==========================================

-- Lead management indexes
CREATE INDEX IF NOT EXISTS idx_quotes_qualification_status ON quotes(qualification_status);
CREATE INDEX IF NOT EXISTS idx_quotes_lead_score ON quotes(lead_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_quotes_conversion_likelihood ON quotes(conversion_likelihood DESC NULLS LAST);

-- Follow-up automation indexes
CREATE INDEX IF NOT EXISTS idx_quotes_next_follow_up ON quotes(next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

-- Admin filtering indexes
CREATE INDEX IF NOT EXISTS idx_quotes_internal_priority ON quotes(internal_priority)
  WHERE internal_priority IS NOT NULL;

-- Conversion funnel indexes
CREATE INDEX IF NOT EXISTS idx_quotes_quoted_at ON quotes(quoted_at)
  WHERE quoted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_booked_at ON quotes(booked_at)
  WHERE booked_at IS NOT NULL;

-- Financial reporting index
CREATE INDEX IF NOT EXISTS idx_quotes_estimated_value_max ON quotes(estimated_value_max DESC NULLS LAST);

COMMENT ON INDEX idx_quotes_qualification_status IS 'Fast filtering by lead temperature';
COMMENT ON INDEX idx_quotes_lead_score IS 'Sort leads by quality score (highest first)';
COMMENT ON INDEX idx_quotes_next_follow_up IS 'Find leads due for follow-up (partial index for efficiency)';

-- ==========================================
-- STEP 6: Add Validation Constraints
-- ==========================================

-- Ensure lead_score is 0-100 if provided
ALTER TABLE quotes ADD CONSTRAINT check_lead_score_range
  CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100));

-- Ensure conversion_likelihood is 0.00-1.00 if provided
ALTER TABLE quotes ADD CONSTRAINT check_conversion_likelihood_range
  CHECK (conversion_likelihood IS NULL OR (conversion_likelihood >= 0 AND conversion_likelihood <= 1));

-- Ensure qualification_status uses valid values
ALTER TABLE quotes ADD CONSTRAINT check_qualification_status_valid
  CHECK (qualification_status IS NULL OR qualification_status IN ('hot', 'warm', 'cold', 'unqualified'));

-- Ensure internal_priority uses valid values
ALTER TABLE quotes ADD CONSTRAINT check_internal_priority_valid
  CHECK (internal_priority IS NULL OR internal_priority IN ('high', 'medium', 'low'));

-- ==========================================
-- VERIFICATION QUERY
-- ==========================================

-- Run this after migration to verify new columns exist:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'quotes'
-- ORDER BY ordinal_position;

-- ==========================================
-- ROLLBACK (if needed)
-- ==========================================

-- To rollback this migration, run:
-- ALTER TABLE quotes DROP COLUMN IF EXISTS estimated_value_min;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS estimated_value_max;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS lead_score;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS qualification_status;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS conversion_likelihood;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS estimation_engine_version;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS estimated_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS confirmation_email_sent_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS estimate_email_sent_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS last_contact_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS next_follow_up_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS whatsapp_sent_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS assigned_to;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS admin_notes;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS internal_priority;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS quoted_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS booked_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS completed_at;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS final_value;
-- DROP INDEX IF EXISTS idx_quotes_qualification_status;
-- DROP INDEX IF EXISTS idx_quotes_lead_score;
-- DROP INDEX IF EXISTS idx_quotes_conversion_likelihood;
-- DROP INDEX IF EXISTS idx_quotes_next_follow_up;
-- DROP INDEX IF EXISTS idx_quotes_internal_priority;
-- DROP INDEX IF EXISTS idx_quotes_quoted_at;
-- DROP INDEX IF EXISTS idx_quotes_booked_at;
-- DROP INDEX IF EXISTS idx_quotes_estimated_value_max;
