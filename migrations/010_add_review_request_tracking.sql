-- Migration 010: Add review request tracking to jobs table
-- Tracks when review requests are sent so we don't spam customers

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_request_sent_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_request_channel text; -- 'email', 'whatsapp', 'both'

-- Index for finding jobs that need review requests
CREATE INDEX IF NOT EXISTS idx_jobs_review_pending
  ON jobs(status, review_request_sent_at)
  WHERE status = 'completed' AND review_request_sent_at IS NULL;
