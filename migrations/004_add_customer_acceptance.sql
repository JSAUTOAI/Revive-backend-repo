-- Migration 004: Add Customer Acceptance Tracking
-- Purpose: Track when customers accept quote estimates via email/WhatsApp links
-- Created: 2026-02-14

-- Add acceptance tracking columns to quotes table
ALTER TABLE quotes
ADD COLUMN IF NOT EXISTS customer_accepted_estimate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS customer_accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS customer_response text;

-- Add index for filtering accepted quotes in admin dashboard
CREATE INDEX IF NOT EXISTS idx_quotes_customer_accepted
ON quotes(customer_accepted_estimate, customer_accepted_at DESC)
WHERE customer_accepted_estimate = true;

-- Add comment for documentation
COMMENT ON COLUMN quotes.customer_accepted_estimate IS 'True if customer clicked "Accept Quote" link';
COMMENT ON COLUMN quotes.customer_accepted_at IS 'Timestamp when customer accepted the estimate';
COMMENT ON COLUMN quotes.customer_response IS 'Customer response type: accepted, declined, or has_questions (future)';
