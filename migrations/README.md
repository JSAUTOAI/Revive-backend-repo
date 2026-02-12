# Database Migrations

This folder contains SQL migration files for the Revive backend database.

## Migration History

| # | File | Description | Date | Status |
|---|------|-------------|------|--------|
| 001 | `001_initial.sql` | Initial quotes table creation | 2026-02-11 | ✅ Applied |
| 002 | `002_add_estimation_and_tracking.sql` | Add estimation, lead scoring, and tracking columns | 2026-02-12 | ⏳ Pending |

## How to Run Migrations

### In Supabase SQL Editor:

1. Go to your Supabase project: https://supabase.com/dashboard/project/ickswhkyteuppmocvnxj
2. Click "SQL Editor" in the left sidebar
3. Click "+ New query"
4. Copy the contents of the migration file
5. Paste into the SQL editor
6. Click "Run" (or press Cmd/Ctrl + Enter)
7. Verify success message
8. Update the Status column in the table above to ✅

### Verification

After running a migration, verify it worked:

```sql
-- Check new columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'quotes'
ORDER BY ordinal_position;

-- Check indexes were created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'quotes';
```

## Rollback

Each migration file includes a rollback section at the bottom. Only use if absolutely necessary - rollbacks will delete data in those columns.

## Best Practices

- ✅ Always run migrations in order (001, 002, 003...)
- ✅ Always back up data before running migrations (Supabase does this automatically, but can export manually)
- ✅ Test on a development database first if possible
- ✅ Never edit a migration file after it's been run in production
- ✅ Create a new migration file for changes instead
