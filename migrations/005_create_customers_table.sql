-- Migration 005: Create Customers Table & Link to Quotes/Jobs
-- Purpose: Central customer profiles, auto-populated from quotes
-- Safe to run: Uses IF NOT EXISTS, won't break existing data
-- Created: 2026-02-19

-- ==========================================
-- STEP 1: Create Customers Table
-- ==========================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  postcode TEXT,
  tags TEXT[] DEFAULT '{}',
  admin_notes TEXT,
  total_spent NUMERIC(10,2) DEFAULT 0,
  total_jobs INTEGER DEFAULT 0,
  last_job_date DATE,
  first_contact_date TIMESTAMPTZ DEFAULT now(),
  last_followup_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- STEP 2: Indexes for Customer Lookups
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_postcode ON customers(postcode);
CREATE INDEX IF NOT EXISTS idx_customers_last_job ON customers(last_job_date);

-- ==========================================
-- STEP 3: Auto-update updated_at Trigger
-- ==========================================

CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_customers_updated_at ON customers;
CREATE TRIGGER trigger_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_updated_at();

-- ==========================================
-- STEP 4: Add customer_id FK to Existing Tables
-- ==========================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE recurring_jobs ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);

-- ==========================================
-- STEP 5: Backfill - Create Customers from Existing Quotes
-- ==========================================

-- This creates one customer per unique email from existing quotes
-- and links those quotes to the new customer record

INSERT INTO customers (name, email, phone, address, postcode, first_contact_date)
SELECT DISTINCT ON (LOWER(email))
  name,
  email,
  phone,
  address_line1,
  postcode,
  MIN(created_at) OVER (PARTITION BY LOWER(email))
FROM quotes
WHERE email IS NOT NULL AND email != ''
ORDER BY LOWER(email), created_at ASC
ON CONFLICT DO NOTHING;

-- Link existing quotes to their customer records
UPDATE quotes q
SET customer_id = c.id
FROM customers c
WHERE LOWER(q.email) = LOWER(c.email)
  AND q.customer_id IS NULL;

-- Link existing jobs to their customer records (by matching email via quotes)
UPDATE jobs j
SET customer_id = q.customer_id
FROM quotes q
WHERE j.quote_id = q.id
  AND q.customer_id IS NOT NULL
  AND j.customer_id IS NULL;

-- ==========================================
-- VERIFICATION
-- ==========================================

-- Run after migration to verify:
-- SELECT COUNT(*) AS customer_count FROM customers;
-- SELECT COUNT(*) AS linked_quotes FROM quotes WHERE customer_id IS NOT NULL;
-- SELECT COUNT(*) AS linked_jobs FROM jobs WHERE customer_id IS NOT NULL;
