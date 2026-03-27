-- Migration 011: Add Stripe payment fields to invoices table
-- Supports Stripe Checkout Sessions for invoice payments

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_session_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_url text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method text; -- 'stripe', 'bank_transfer', 'cash', 'cheque'

-- Index for looking up invoices by Stripe session
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session
  ON invoices(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
