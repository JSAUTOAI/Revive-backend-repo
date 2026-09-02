# Revive Dashboard — System Breakdown & Audit

> **Purpose**: Self-contained reference for recreating this system inside another project (e.g. JSflowforge Business Management System). Drop this file into the target repo and have Claude read it.
>
> **Generated**: 2026-05-01
> **Source repo**: `c:\Users\psacc\Revive-Site`
> **Status**: Production, deployed to Railway, actively used by Revive Exterior Cleaning Solutions.

---

## 1. What This System Is

A production-grade lead-to-cash CRM for an exterior cleaning business. It ingests web quote submissions, auto-prices them (rule-based + AI vision), scores leads, automates follow-ups across email + WhatsApp, walks customers through a multi-stage pipeline from quote → photos → fixed price → booking → job → invoice, and tracks the entire business finance side (expenses, wages, mileage, tax) on top.

It is a single Express monolith on Railway, backed by Supabase Postgres, with one big admin SPA at `/admin.html`.

**Core principle**: every external integration (email, WhatsApp, AI, Sheets, Stripe) is in its own service module under `/services` and is non-blocking — the customer-facing API responds immediately and side effects fire async. Failures in side effects are logged but don't break the primary flow.

---

## 2. Stack & Top-Level Layout

```
revive-site/
├── index.js                  # Entry point (~1,484 lines). Express app, wires routes, starts cron.
├── package.json              # 12 deps, all in production use
├── .env.example              # ⚠️ OUTDATED — only 8 of ~30 actual env vars listed
├── /routes/
│   ├── admin.js              # Quote CRUD, attachments, settings, pipeline stats
│   ├── customers.js          # Customer profiles, bulk import, analytics
│   ├── jobs.js               # Job scheduling, recurring jobs, team members
│   ├── invoices.js           # Invoice generation, public view, Stripe webhooks
│   ├── finance.js            # Expenses, wages, mileage, income, tax, reports
│   ├── pipeline.js           # Customer-facing photo upload, final price, booking pages
│   └── webhooks.js           # Resend + Twilio webhook receivers (signature-validated)
├── /services/
│   ├── chatbot.js            # Claude Haiku conversational agent + tool use
│   ├── emailer.js            # Resend wrapper, all HTML email templates inline
│   ├── whatsapp.js           # Twilio WhatsApp wrapper, content template SIDs
│   ├── estimator.js          # Rule-based pricing engine (v1.2)
│   ├── visionPricer.js       # Claude Vision photo analysis → fixed price + confidence
│   ├── estimationJob.js      # Async orchestration, retry-on-startup
│   ├── scorer.js             # 0-100 lead score, hot/warm/cold buckets
│   ├── pipelineManager.js    # Multi-stage pipeline state machine
│   ├── followUpScheduler.js  # node-cron hourly job, pipeline-aware templates
│   ├── googleSheets.js       # Sync quotes to Sheets (creds via JSON env or file)
│   ├── pricingConfig.js      # DB-backed pricing with 5-min cache, file fallback
│   ├── stripe.js             # Stripe Checkout sessions
│   └── logger.js             # Winston structured logging, child loggers per module
├── /config/
│   └── pricing.js            # Default pricing rules (fallback when DB unavailable)
├── /public/
│   ├── admin.html            # 456 KB single-file admin SPA, dark theme
│   ├── chat-widget.js        # 20 KB embeddable widget (loads on Aura site)
│   ├── upload-photos.html    # Customer drag-drop photo upload
│   ├── final-price.html      # (rendered via route — accept-final-price page)
│   ├── book-slot.html        # Customer-facing booking calendar
│   ├── my-schedule.html      # Team member schedule view (UUID-protected)
│   ├── logo.png, sitemap.xml, robots.txt, llms.txt
└── /migrations/              # 10 SQL files, numbered 002-012 (run manually in Supabase)
```

**Dependencies** (`package.json`):

| Package | Use |
|---|---|
| `express` ^5.2.1 | Web framework |
| `@supabase/supabase-js` ^2.95.3 | DB client (service-role key, server-side only) |
| `@anthropic-ai/sdk` ^0.77.0 | Chatbot, vision pricing, receipt OCR |
| `resend` ^6.9.2 | Transactional email |
| `twilio` ^5.12.1 | WhatsApp |
| `stripe` ^20.4.1 | Payment Checkout (optional — bank transfer fallback) |
| `googleapis` ^171.4.0 | Google Sheets sync |
| `node-cron` ^4.2.1 | Hourly follow-up scheduler |
| `express-rate-limit` ^8.3.1 | Rate limit `/api/quote` and `/api/chat` |
| `json2csv` ^6.0.0-alpha.2 | CSV export |
| `winston` ^3.19.0 | Structured logs |
| `dotenv` ^17.2.4 | .env loading |

No test framework. No linter. No TypeScript. No build step.

---

## 3. Routes Reference

### Public (no auth)
- `GET /` — landing
- `GET /health` — `{status:'ok', timestamp}` for monitoring
- `GET /api/structured-data` — JSON-LD LocalBusiness schema for SEO/AI
- `POST /api/quote` — quote intake. Rate-limited 5/hr/IP. Triggers estimation, confirmation email, WhatsApp, Sheets sync (all async).
- `POST /api/chat` — chatbot turn. Rate-limited 30 messages/10min in-memory + 60/10min via express-rate-limit.
- `GET /api/chat/history?sessionId=` — restore prior chat
- `GET /upload-photos/:quoteId` — customer photo upload page
- `POST /api/pipeline/:quoteId/upload-photos`
- `GET /final-price/:quoteId` — customer accepts fixed price
- `POST /api/pipeline/:quoteId/accept-final-price`
- `GET /book/:quoteId` — customer picks slot
- `POST /api/pipeline/:quoteId/book-slot`
- `GET /api/pipeline/:quoteId/status`
- `GET /invoice/:token` — public invoice view (token in URL)
- `GET /invoice/:token/pay` — Stripe Checkout if configured, else bank transfer page
- `GET /api/my-schedule/:memberId` — team member schedule (UUID = "auth")
- `PATCH /api/my-schedule/:memberId/jobs/:jobId`

### Webhooks (signature-validated, no bearer)
- `POST /webhooks/resend` — HMAC-SHA256 via `svix-signature`. Tracks delivered/opened/clicked/bounced/complained.
- `POST /webhooks/twilio` — HMAC-SHA1 via `x-twilio-signature`. Tracks message status.
- `POST /webhooks/stripe` — Stripe sig. Updates invoice on `checkout.session.completed`.

### Admin (Bearer token via `ADMIN_TOKEN`)
**Quotes**: list, get, status patch, notes patch, generic patch, activity timeline, attachments (upload/list/delete), soft-delete + restore, CSV export
**Pricing settings**: get/put/reset/test
**Pipeline**: stats, pending approvals, settings
**Customers**: list, search typeahead, stats, CSV import, bulk follow-up + preview, analytics, create, get, patch, manual follow-up
**Jobs**: list, create, patch, delete, notify-reschedule, request-review, week view, recurring (CRUD + generate), team members (CRUD)
**Invoices**: create from job, list, get, patch, send

### Finance (admin auth)
Categories, expenses (with receipt OCR via Claude Vision), wages, mileage, recurring expenses (with auto-generation), income, capital assets, tax savings, audit log + restore, reports (summary/cashflow/category/tax), tax forecast, exports.

---

## 4. Database Schema (10 migrations, all in `/migrations`)

| File | Adds |
|---|---|
| `002_add_estimation_and_tracking.sql` | estimation columns, lead score, communication timestamps, qualification status, indexes |
| `004_add_customer_acceptance.sql` | accepted_at flag |
| `005_create_customers_table.sql` | customers table (auto-linked from quotes) |
| `006_create_finance_tables.sql` | expenses, wages, mileage, income, recurring, categories, capital_assets, tax_savings |
| `007_finance_audit_trail.sql` | finance_audit_log + triggers |
| `008_add_follow_up_step.sql` | follow_up_step counter on quotes |
| `009_add_deleted_at.sql` | soft-delete column |
| `010_add_review_request_tracking.sql` | review_requested_at |
| `011_add_stripe_payment_fields.sql` | stripe_session_id, stripe_payment_intent_id, payment_method |
| `012_quote_to_booking_pipeline.sql` | pipeline_stage, photo_count, photos_requested_at, photos_uploaded_at, final_price, final_price_confidence, final_price_admin_approved, customer_accepted_final_price, booking_offered_at, booked_date, booked_time_slot, booked_job_id, plus pipeline_config in settings |

**Key tables (effective shape after all migrations)**:

- **quotes** — lead funnel record. ~40 columns. `services` is text[] with GIN index. `answers` is jsonb (form fields). Pipeline state lives here.
- **customers** — auto-created/linked on quote submission, has `tags[]`, `total_jobs`, `total_spent`.
- **jobs** — scheduled work. Linked to quote, customer, optional recurring_job_id. Has `assigned_to` (team_member id), `time_slot`, `status`.
- **recurring_jobs** — template for weekly/biweekly/monthly generation
- **team_members** — name, phone, hourly rate, schedule UUID
- **invoices** — line_items jsonb, vat_rate, payment_status, view_token (public link), Stripe IDs
- **finance_expenses, finance_wages, finance_mileage, finance_income, finance_recurring, finance_assets** — finance domain
- **expense_categories** — color-coded, sortable
- **finance_audit_log** — before/after JSON, append-only
- **chat_conversations** — sessionId-keyed, message history for chat widget
- **quote_activity** — timeline of admin actions + webhook events
- **settings** — key/value singleton table for pricing_config and pipeline_config (cached 5min)
- **pricing_history** — versioned pricing changes

**Indexes worth noting**: `services` GIN, `qualification_status`, `lead_score DESC`, `next_follow_up_at WHERE NOT NULL`, `conversion_likelihood DESC`.

---

## 5. Feature Inventory

Every feature in the system, with its wiring status.

### A. Quote intake — ✅ complete
`POST /api/quote` → insert → async fan-out (estimation, confirmation email, WhatsApp, Sheets, customer-link). Rate-limited 5/hr.

### B. Estimation engine — ✅ complete
`services/estimator.js` calculates min/max from service × size × modifiers using config-driven rules. v1.2. Can be re-run.

### C. AI vision pricing — ✅ complete
`services/visionPricer.js` uses Claude 3.5 Sonnet on uploaded photos → single fixed price + confidence + reasoning. Admin must approve before customer sees it (controlled by `pricing_mode: 'ai_suggest_admin_approves'`).

### D. Lead scoring — ✅ complete
`services/scorer.js` returns 0–100 score, hot/warm/cold/unqualified bucket, conversion likelihood. Drives admin-alert threshold.

### E. Admin dashboard — ✅ complete
`public/admin.html` is a 456 KB single-file SPA. Dark theme, lime-green accent (#84cc16). Full CRUD across quotes, customers, jobs, invoices, finance. Inline editing, drag-drop reschedule, activity timelines, attachment upload, bulk operations, CSV exports, charts.

### F. Email automation — ✅ complete
8 email types via Resend: confirmation, estimate, follow-up step 1 + 2, admin alert (hot leads), photo request, final price offer, invoice, review request. HTML templates inlined in `services/emailer.js`. Webhook tracks delivery.

### G. WhatsApp automation — ⚠️ mostly complete, one template missing
Twilio WhatsApp Business with Meta-approved content templates. Templates configured: QUOTE_CONFIRMATION, ESTIMATE_READY, ADMIN_ALERT, PHOTO_REQUEST, FINAL_PRICE, BOOKING_CONFIRMATION. **`TWILIO_FOLLOW_UP_TEMPLATE` env var is empty** — follow-up WhatsApp messages will silently no-op until set. Email follow-ups still work.

### H. Follow-up sequences — ✅ complete
`node-cron` runs `0 * * * *` (top of every hour). Finds quotes due for follow-up, sends email + WhatsApp, advances `follow_up_step`, schedules next or marks complete. 2-step legacy flow (3d, 7d) plus pipeline-aware variants for photos_requested / final_price_sent / booking_offered stages.

### I. Chat widget — ✅ complete
`public/chat-widget.js` embeds on the Aura frontend. Calls `/api/chat`. Backend routes to `services/chatbot.js` (Claude Haiku 4.5) with two tools: `capture_lead` and `prepare_quote_form`. Session persistence in `chat_conversations`. Restores history for returning visitors.

### J. Quote-to-booking pipeline — ✅ complete (most recent feature)
Multi-stage state machine in `services/pipelineManager.js`:
`estimate_pending → estimate_sent → photos_requested → photos_uploaded → final_price_pending_approval → final_price_sent → final_price_accepted → booking_offered → booked`
Each stage has its own customer-facing page under `/routes/pipeline.js` and customer-facing HTML in `/public/`. Pipeline config (thresholds, reminder days, lookahead, max jobs/day, honesty clause) is editable in admin under settings.

### K. Job scheduling & teams — ✅ complete
Calendar UI in admin. Drag-to-reschedule, time slots, assigned team members, recurring templates that auto-generate. Team members get a public schedule URL `/api/my-schedule/:memberId` (UUID acts as auth).

### L. Invoicing — ✅ complete (Stripe optional)
Generate from completed job, sequential invoice numbers (INV-0001…), VAT configurable per invoice (0/5/20%), public view via token URL, email send via Resend, payment via Stripe Checkout *if* keys configured, else bank transfer details only. Stripe webhook updates `payment_status`, creates corresponding `finance_income` row.

### M. Finance & expense tracking — ✅ complete (large surface)
Expenses with **receipt photo OCR via Claude Vision** (extracts amount/supplier/date, auto-categorises, dupe detects within ±1 day). Wages, mileage, income, recurring expenses with auto-generation, capital asset depreciation, tax savings. Full audit log (before/after JSON) with restore. Reports: monthly P&L, quarterly cashflow, category breakdown, tax forecast & summary. CSV/Excel export.

### N. Google Sheets sync — ✅ complete
Quotes mirrored to a Google Sheet for the owner's manual workflow. Auth via service account — supports either `GOOGLE_CREDENTIALS_PATH` (file, dev) or `GOOGLE_SERVICE_ACCOUNT_JSON` (env, production). Non-blocking.

### O. Google review requests — ✅ complete (modulo one env var)
After job marked complete, admin clicks "Request Review" → email with link to Google Business Profile. **`GOOGLE_REVIEW_URL` env var is empty** — link will be broken until set.

### P. SEO + AI discoverability — ✅ complete
JSON-LD LocalBusiness + Service schema served at `/api/structured-data`. `sitemap.xml`, `robots.txt`, `llms.txt` for LLM discovery.

### Q. Webhooks — ✅ complete
All three (Resend, Twilio, Stripe) signature-validated. No bearer auth — they don't need it.

### R. Soft delete + audit trail — ✅ complete
Quotes can be soft-deleted (X button per row in admin) and restored. Finance changes go through audit log triggers.

### S. Rate limiting + input sanitisation — ✅ complete
`express-rate-limit` on `/api/quote` (5/hr) and `/api/chat` (60/10min). Plus an in-memory secondary check on chat (30/10min/session). Input sanitisation on free-text fields.

### T. Health endpoint — ✅ complete

---

## 6. Environment Variables (Complete List)

⚠️ **`.env.example` in this repo is outdated** — only 8 vars listed. The real list is below. When recreating, generate a fresh `.env.example` from this section.

### Core infra
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — service role, server-only
- `PORT` — defaults to 3000
- `LOG_LEVEL` — info / debug / warn / error
- `ADMIN_TOKEN` — bearer token gating all `/admin/*` and `/admin/jobs/*` routes
- `BASE_URL` — backend public URL (used in email/WA links)
- `ALLOWED_ORIGINS` — CORS allowlist, comma-separated

### Email (Resend)
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET` — for `/webhooks/resend` signature check
- `FROM_EMAIL` — verified sender
- `ADMIN_EMAIL` — recipient for hot-lead alerts

### WhatsApp (Twilio)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_NUMBER` — sender, e.g. `+44…`
- `ADMIN_PHONE` — recipient for admin WA alerts
- `TWILIO_FOLLOW_UP_TEMPLATE` ⚠️ currently empty
- `TWILIO_PHOTO_REQUEST_TEMPLATE`
- `TWILIO_FINAL_PRICE_TEMPLATE`
- `TWILIO_BOOKING_CONFIRMATION_TEMPLATE`
- (template SIDs for QUOTE_CONFIRMATION, ESTIMATE_READY, ADMIN_ALERT are hardcoded in `services/whatsapp.js` — should be moved to env)

### AI (Anthropic)
- `ANTHROPIC_API_KEY` — used by chatbot, vision pricer, receipt OCR

### Google Sheets
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS_PATH` — path to service-account JSON file (dev)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — full JSON inline (production)

### Google reviews
- `GOOGLE_REVIEW_URL` ⚠️ currently empty — Google Business Profile review link

### Payments (Stripe — optional)
- `STRIPE_SECRET_KEY` — if absent, invoices fall back to bank transfer only
- `STRIPE_WEBHOOK_SECRET`

### Business identity (used in invoices, emails, structured data)
- `BUSINESS_NAME`
- `BUSINESS_ADDRESS`
- `BUSINESS_PHONE`
- `BUSINESS_EMAIL`
- `BUSINESS_LOGO_URL`
- `BUSINESS_BANK_NAME`
- `BUSINESS_ACCOUNT_NAME`
- `BUSINESS_SORT_CODE`
- `BUSINESS_ACCOUNT_NUMBER`

For the recreation: every `BUSINESS_*` var should become tenant-scoped settings in DB rather than env vars, since you'll have multiple businesses on the platform.

---

## 7. Cron, Async & Background Work

| Job | Trigger | Where |
|---|---|---|
| Follow-up sweep | `node-cron` `0 * * * *` (hourly) | `services/followUpScheduler.js` started in `index.js` |
| Estimation queue | `setTimeout(…, 1000ms)` after quote insert | `services/estimationJob.js` `queueEstimation()` |
| Estimation retry | Once on server startup | `services/estimationJob.js` `retryMissedEstimations()` — last 7 days, 2s spacing |
| Recurring expense generation | Manual admin trigger | `routes/finance.js` |
| Recurring job generation | Manual admin trigger | `routes/jobs.js` |
| Sheets sync | Fire-and-forget after quote insert | `services/googleSheets.js` |

**Note**: `setTimeout`-based queueing is fine at current volume but won't survive a process restart mid-job. The retry-on-startup partially compensates. For multi-tenant scale, swap for BullMQ + Redis.

---

## 8. AI Integration Map

| Surface | Model | Notes |
|---|---|---|
| Chatbot | `claude-haiku-4-5-20251001` | Hardcoded in `services/chatbot.js` line ~19. Tool use enabled. |
| Vision pricing (photos → fixed price) | Claude 3.5 Sonnet | `services/visionPricer.js` |
| Receipt OCR (expense scanning) | Claude Sonnet | `routes/finance.js` upload handler |
| AI estimation enhancement | Claude (via estimator) | Optional layer in `services/estimator.js` |

Hardcoded model IDs are technical debt — expose as `CHAT_MODEL`, `VISION_MODEL`, `OCR_MODEL` env vars in the recreation.

---

## 9. Loose Ends & Audit Findings

### Must-fix
1. **`.env.example` is severely out of date** — lists 8 of ~30 vars. Anyone cloning the repo (including future-you, including LLM agents) gets misled. Regenerate from §6 above.
2. **`TWILIO_FOLLOW_UP_TEMPLATE` empty** — automated WhatsApp follow-ups (the recurring Step 1/Step 2 nudges) silently fail. Email follow-ups still go out. Need to create the template in Twilio Content Builder, get the HX… SID, set the env var.
3. **`GOOGLE_REVIEW_URL` empty** — review-request emails contain a broken link. Grab the share URL from your Google Business Profile and set it.
4. **WhatsApp template SIDs hardcoded** in `services/whatsapp.js` for QUOTE_CONFIRMATION / ESTIMATE_READY / ADMIN_ALERT. Move to env vars for portability — critical when recreating in a multi-tenant project where every customer needs their own template SIDs.

### Should-fix
5. **No tests.** `package.json` has the placeholder `"test": "echo \"Error: no test specified\""`. Estimation rules and lead scoring are deterministic — they're the highest-value targets for unit tests.
6. **Hardcoded Claude model IDs** in chatbot/vision/OCR. Move to env vars.
7. **Hardcoded chat rate limits** (CHAT_RATE_WINDOW=10min, CHAT_RATE_MAX=30) in `index.js` ~line 410. Move to env or settings table.
8. **Estimation job durability** — `setTimeout` + startup retry is the documented Phase 3 approach (see comment at top of `estimationJob.js`). Acceptable here, replace with BullMQ in the multi-tenant rewrite.

### Verify (not necessarily broken, but worth checking)
9. **Migrations 002–012 must be run on Supabase.** No automated migration runner — they're applied via the Supabase SQL editor by hand. If you ever spin up a new Supabase project, run them in order. Migration `001` and `003` aren't present — assume they were squashed into the initial schema.
10. **No Row-Level Security (RLS) on Supabase tables** — fine because backend uses the service role and frontend never talks to Supabase directly. If the recreation ever gives the frontend direct Supabase access, RLS becomes mandatory.
11. **Single admin user model.** Everything gates on one `ADMIN_TOKEN`. For the multi-tenant recreation, this is the biggest architectural change — needs proper auth (Supabase Auth, Clerk, or similar) with per-business scoping.

### Intentional, not a problem
12. Many `.catch(() => {})` in admin/pipeline routes — non-critical side effects (Sheets sync, secondary emails). Errors are still logged via Winston.
13. No commented-out dead code. No TODOs/FIXMEs. The codebase is genuinely clean.

---

## 10. Recreation Notes for the Multi-Tenant Build

When porting into the JSflowforge Business Management System, the *biggest* architectural shifts:

1. **Multi-tenancy.** Every quote, customer, job, invoice, expense, setting, and template SID needs a `business_id` foreign key. The `BUSINESS_*` env vars become per-tenant DB settings. The `ADMIN_TOKEN` becomes proper user-scoped auth (Supabase Auth, with a `users.business_id`).
2. **Auth.** Replace bearer-token middleware with session-based auth + RLS on Supabase if frontend ever queries directly.
3. **Per-tenant integrations.** Each business connects their own Resend domain, Twilio account (or you reseller-route through one master account), Stripe Connect for payments, Google Sheets, Google Review URL. Onboarding flow needs to capture these.
4. **Pricing config is already DB-driven** — good. Just scope it by business.
5. **WhatsApp templates** — biggest pain point. Each business needs Meta-approved templates. Either: (a) shared templates with merge variables (where Meta allows), (b) onboarding step where each tenant submits their own and the SIDs land in their settings row.
6. **AI cost passthrough.** Right now Claude API costs hit one Anthropic key. Multi-tenant means either rate-limiting per business, AI-credits metering, or pricing AI features into a higher plan tier.
7. **Job durability.** Move estimation queue from `setTimeout` to BullMQ + Redis. Same for pipeline stage advancement. Critical at multi-tenant scale.
8. **Frontend.** The 456 KB single-file `admin.html` is a liability for a product. Either keep it (and embed per-tenant via subdomain routing), or rebuild as a real React/Next app with the same backend.

The Express + Supabase + Resend + Twilio + Anthropic stack itself is the right foundation — don't change it. Most of the service-layer code (`emailer.js`, `whatsapp.js`, `estimator.js`, `scorer.js`, `pipelineManager.js`, `followUpScheduler.js`, `visionPricer.js`) ports almost as-is, just with a `businessId` parameter threaded through.

---

## 11. Recent Activity (last 30 commits)

```
5574590 feat: Add automated quote-to-booking pipeline
1f53fcd feat: Add automated Google review request system
97c0e0d feat: Add SEO, AI discoverability, and structured logging
5061068 feat: CORS, structured logging, reports tab, AI estimation, WhatsApp follow-ups
526fb8e chore: Repo cleanup, track migrations, fix hardcoded fallbacks, health endpoint
2a14259 feat: Webhook validation, estimation retry, admin UX improvements
da68f0b feat: Rate limiting and input sanitisation
a20fb5b feat: Soft delete for quotes
3cde99d fix: Finance audit trail, auth middleware, admin UI
5d8e259 feat: Automated follow-up email scheduler
6f2927b fix: Clean up Aura-baked chat widget duplicates
191907a fix: Prevent chat widget from initialising multiple times
a97a9ef feat: Receipt category splitting and bulk upload
ea9eed6 fix: Improve receipt scanner with Sonnet model
744527b feat: Receipt photo scanning with AI OCR
1869ab3 feat: Business finance & expense tracking system
8ec5111 feat: Guided chatbot pricing flow with form pre-fill
fdcd3ff feat: Custom services in pricing settings
fcade55 feat: Manual customer creation and CSV import
dd9cbcf feat: Admin-configurable pricing & estimation settings
fc5b397 feat: Chatbot lead capture, persistence, admin dashboard
f2ebe82 feat: Logo and account name to invoices
6bd651b feat: Built-in invoicing system
527ed0e feat: Analytics tracking + business analytics overhaul
148bd46 fix: Book This Job crash
f6d2774 fix: Book This Job defaults to today
c5e773a fix: Streamline quote-to-job booking flow
0ddaab0 feat: Redesign quote modal as full lead management hub
a5c247a feat: Inline editing, quick reassign, drag-and-drop
004d254 fix: Remove newlines from WhatsApp template variables
```

---

## 12. TL;DR for the Recreation Prompt

> *"Recreate this system as a multi-tenant Business Management SaaS. Stack: Express + Supabase + Resend + Twilio + Anthropic + Stripe Connect. Port the service modules nearly verbatim, threading `businessId` through. Replace bearer-token admin auth with proper user auth + RLS. Move all `BUSINESS_*` env vars and hardcoded WhatsApp template SIDs to per-tenant settings. Replace `setTimeout` job queue with BullMQ. Onboarding must capture each tenant's Resend domain, Twilio templates, Google Sheet, Stripe account, and review URL. The 456 KB admin SPA needs rebuilding as a real React app. The hard logic — estimation, scoring, pipeline state machine, follow-up scheduler, vision pricing, receipt OCR — is the crown jewel and ports as-is."*
