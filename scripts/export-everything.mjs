/**
 * READ ONLY. Pulls every row of every table out of the Revive Supabase project
 * into JSON files on disk.
 *
 * This is a backup first and an import source second. It writes OUTSIDE both
 * git repos, because these files contain real customer names, addresses, phone
 * numbers and email addresses, and none of that belongs in version control.
 *
 *   set -a && . ./.env && set +a
 *   node scripts/export-everything.mjs
 *
 * Output: C:/Users/psacc/revive-export-<date>/<table>.json  plus manifest.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const TABLES = [
  'customers',
  'quotes',
  'quote_activity',
  'jobs',
  'recurring_jobs',
  'team_members',
  'invoices',
  'chat_conversations',
  'expenses',
  'expense_categories',
  'recurring_expenses',
  'income_entries',
  'wage_payments',
  'mileage_log',
  'capital_assets',
  'tax_savings',
  'settings',
  'pricing_history',
  'finance_audit_log',
];

const stamp = new Date().toISOString().slice(0, 10);
const outDir = `C:/Users/psacc/revive-export-${stamp}`;
mkdirSync(outDir, { recursive: true });

const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** Not every table is keyed on `id` — settings is keyed on its `key` column. */
const ORDER_BY = { settings: 'key' };

/** Paged, because a single request caps out and a partial export is worthless. */
async function fetchAll(table) {
  const orderBy = ORDER_BY[table] ?? 'id';
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(
      `${url}/rest/v1/${table}?select=*&order=${orderBy}.asc&offset=${from}&limit=${pageSize}`,
      { headers },
    );
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status} ${body.slice(0, 120)}` };
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows };
}

const manifest = { exportedAt: new Date().toISOString(), project: url, tables: {} };

console.log(`writing to ${outDir}\n`);

for (const table of TABLES) {
  const result = await fetchAll(table);

  if (result.error) {
    // A table this app never created is not a failure of the export — it is a
    // fact about the export, and it belongs in the manifest either way.
    console.log(`   ${table.padEnd(20)} skipped — ${result.error}`);
    manifest.tables[table] = { rows: null, note: result.error };
    continue;
  }

  writeFileSync(`${outDir}/${table}.json`, JSON.stringify(result.rows, null, 2), 'utf8');

  const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];
  manifest.tables[table] = { rows: result.rows.length, columns };
  console.log(`   ${table.padEnd(20)} ${String(result.rows.length).padStart(5)} rows, ${columns.length} columns`);
}

writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');

const total = Object.values(manifest.tables).reduce((n, t) => n + (t.rows ?? 0), 0);
console.log(`\n${total} rows exported to ${outDir}`);
console.log('manifest.json lists every table with its row count and column names.');
