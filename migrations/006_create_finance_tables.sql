-- Migration 006: Create Finance & Expense Tracking Tables
-- Purpose: Track business expenses, wages, mileage, recurring costs, manual income
-- Safe to run: Uses IF NOT EXISTS, won't break existing data
-- Created: 2026-02-22

-- ==========================================
-- STEP 1: Expense Categories (configurable)
-- ==========================================

CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  colour TEXT DEFAULT '#737373',
  is_tax_deductible BOOLEAN DEFAULT true,
  hmrc_category TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Pre-seed with trade-relevant categories
INSERT INTO expense_categories (name, slug, colour, is_tax_deductible, hmrc_category, sort_order) VALUES
  ('Materials & Supplies', 'materials', '#3b82f6', true, 'cost_of_sales', 1),
  ('Cleaning Solutions', 'cleaning-solutions', '#06b6d4', true, 'cost_of_sales', 2),
  ('Fuel', 'fuel', '#f59e0b', true, 'motor_expenses', 3),
  ('Vehicle Costs', 'vehicle-costs', '#ef4444', true, 'motor_expenses', 4),
  ('Equipment Purchase', 'equipment-purchase', '#8b5cf6', true, 'capital_allowance', 5),
  ('Equipment Hire', 'equipment-hire', '#a855f7', true, 'cost_of_sales', 6),
  ('Tools', 'tools', '#ec4899', true, 'cost_of_sales', 7),
  ('Insurance', 'insurance', '#14b8a6', true, 'admin', 8),
  ('Marketing', 'marketing', '#f97316', true, 'admin', 9),
  ('Software & Subscriptions', 'subscriptions', '#6366f1', true, 'admin', 10),
  ('Uniforms & PPE', 'uniforms-ppe', '#84cc16', true, 'cost_of_sales', 11),
  ('Phone & Internet', 'phone-internet', '#22d3ee', true, 'admin', 12),
  ('Training', 'training', '#a3e635', true, 'admin', 13),
  ('Parking & Tolls', 'parking-tolls', '#fbbf24', true, 'motor_expenses', 14),
  ('Bank Charges', 'bank-charges', '#94a3b8', true, 'admin', 15),
  ('Accountant Fees', 'accountant', '#64748b', true, 'admin', 16),
  ('Office Supplies', 'office', '#d946ef', true, 'admin', 17),
  ('Licensing & Permits', 'licensing', '#0ea5e9', true, 'admin', 18),
  ('Personal', 'personal', '#f43f5e', false, NULL, 99),
  ('Other', 'other', '#737373', true, 'admin', 100)
ON CONFLICT (slug) DO NOTHING;

-- ==========================================
-- STEP 2: Expenses Table (main transaction log)
-- ==========================================

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  vat_amount NUMERIC(10,2) DEFAULT 0,
  net_amount NUMERIC(10,2),
  category_id UUID REFERENCES expense_categories(id),
  payment_method TEXT DEFAULT 'bank_transfer',
  is_business BOOLEAN DEFAULT true,
  job_id UUID,
  supplier TEXT,
  reference TEXT,
  receipt_path TEXT,
  receipt_url TEXT,
  recurring_expense_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_is_business ON expenses(is_business);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON expenses(payment_method);

-- Auto-compute net_amount trigger
CREATE OR REPLACE FUNCTION compute_expense_net()
RETURNS TRIGGER AS $$
BEGIN
  NEW.net_amount = NEW.amount - COALESCE(NEW.vat_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_expense_net ON expenses;
CREATE TRIGGER trigger_expense_net
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION compute_expense_net();

-- ==========================================
-- STEP 3: Wage Payments Table
-- ==========================================

CREATE TABLE IF NOT EXISTS wage_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID,
  team_member_name TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(10,2) NOT NULL,
  payment_type TEXT DEFAULT 'weekly_wage',
  payment_method TEXT DEFAULT 'bank_transfer',
  job_id UUID,
  period_start DATE,
  period_end DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wages_team_member ON wage_payments(team_member_id);
CREATE INDEX IF NOT EXISTS idx_wages_date ON wage_payments(date DESC);

-- ==========================================
-- STEP 4: Mileage Log Table
-- ==========================================

CREATE TABLE IF NOT EXISTS mileage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  miles NUMERIC(6,1) NOT NULL,
  purpose TEXT,
  job_id UUID,
  rate_per_mile NUMERIC(4,2) DEFAULT 0.45,
  is_return BOOLEAN DEFAULT false,
  calculated_amount NUMERIC(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mileage_date ON mileage_log(date DESC);

-- Auto-compute mileage amount trigger
CREATE OR REPLACE FUNCTION compute_mileage_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.calculated_amount = NEW.miles * NEW.rate_per_mile * (CASE WHEN NEW.is_return THEN 2 ELSE 1 END);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mileage_amount ON mileage_log;
CREATE TRIGGER trigger_mileage_amount
  BEFORE INSERT OR UPDATE ON mileage_log
  FOR EACH ROW
  EXECUTE FUNCTION compute_mileage_amount();

-- ==========================================
-- STEP 5: Recurring Expenses Table
-- ==========================================

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  vat_amount NUMERIC(10,2) DEFAULT 0,
  category_id UUID REFERENCES expense_categories(id),
  payment_method TEXT DEFAULT 'bank_transfer',
  is_business BOOLEAN DEFAULT true,
  supplier TEXT,
  frequency TEXT NOT NULL,
  day_of_month INTEGER,
  next_due_date DATE NOT NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  last_generated_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- STEP 6: Income Entries (manual/supplementary)
-- ==========================================

CREATE TABLE IF NOT EXISTS income_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  source TEXT DEFAULT 'cash_job',
  invoice_id UUID,
  job_id UUID,
  payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_income_date ON income_entries(date DESC);

-- ==========================================
-- VERIFICATION
-- ==========================================
-- Run these to verify:
-- SELECT count(*) FROM expense_categories;  -- Should be 20
-- SELECT * FROM expense_categories ORDER BY sort_order;
