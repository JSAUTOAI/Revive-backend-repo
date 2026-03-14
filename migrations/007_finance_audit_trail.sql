-- Migration 007: Finance Audit Trail & Soft-Delete
-- Purpose: Add HMRC-compliant record keeping — soft-delete instead of permanent
--          deletion, plus a change history log for all finance tables.
-- Safe to run: Uses IF NOT EXISTS, won't break existing data
-- Created: 2026-03-01

-- ==========================================
-- STEP 1: Add soft-delete columns to finance tables
-- ==========================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT;

ALTER TABLE wage_payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE wage_payments ADD COLUMN IF NOT EXISTS deleted_by TEXT;

ALTER TABLE mileage_log ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE mileage_log ADD COLUMN IF NOT EXISTS deleted_by TEXT;

ALTER TABLE income_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE income_entries ADD COLUMN IF NOT EXISTS deleted_by TEXT;

ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- Indexes for filtering out soft-deleted records efficiently
CREATE INDEX IF NOT EXISTS idx_expenses_deleted ON expenses(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wages_deleted ON wage_payments(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mileage_deleted ON mileage_log(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_income_deleted ON income_entries(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_deleted ON recurring_expenses(deleted_at) WHERE deleted_at IS NULL;

-- ==========================================
-- STEP 2: Finance audit log table
-- ==========================================

CREATE TABLE IF NOT EXISTS finance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  changed_fields JSONB,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_table ON finance_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_record ON finance_audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON finance_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON finance_audit_log(action);

-- ==========================================
-- STEP 3: Capital assets table
-- ==========================================

CREATE TABLE IF NOT EXISTS capital_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_price NUMERIC(10,2) NOT NULL,
  category TEXT DEFAULT 'plant_machinery' CHECK (category IN ('plant_machinery', 'vehicle', 'office_equipment', 'tools')),
  aia_claimed BOOLEAN DEFAULT true,
  disposal_date DATE,
  disposal_value NUMERIC(10,2),
  expense_id UUID REFERENCES expenses(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assets_date ON capital_assets(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_assets_deleted ON capital_assets(deleted_at) WHERE deleted_at IS NULL;

-- ==========================================
-- STEP 4: Tax savings tracker
-- ==========================================

CREATE TABLE IF NOT EXISTS tax_savings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(10,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tax_savings_date ON tax_savings(date DESC);

-- ==========================================
-- VERIFICATION
-- ==========================================
-- Run these to verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'deleted_at';
-- SELECT count(*) FROM finance_audit_log;
-- SELECT * FROM capital_assets LIMIT 1;
-- SELECT * FROM tax_savings LIMIT 1;
