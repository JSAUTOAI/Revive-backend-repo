/**
 * READ ONLY. Counts rows in the Revive database and shows the newest few
 * invoices so it is obvious whether the history is there.
 *
 * Uses HEAD requests with Prefer: count=exact for the counts, so no customer
 * records are pulled over the wire for those. Writes nothing.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

console.log(`project: ${url}`);

const TABLES = [
  'customers',
  'quotes',
  'jobs',
  'invoices',
  'expenses',
  'income_entries',
  'wage_payments',
  'mileage_log',
  'team_members',
  'capital_assets',
];

async function count(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=0`, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) return `HTTP ${res.status}`;
  // e.g. "0-0/431"
  return res.headers.get('content-range')?.split('/')[1] ?? '?';
}

console.log('\n=== ROW COUNTS ===');
for (const t of TABLES) {
  console.log(`   ${t.padEnd(16)} ${await count(t)}`);
}

async function rows(table, select, order, limit = 5) {
  const res = await fetch(
    `${url}/rest/v1/${table}?select=${select}&order=${order}&limit=${limit}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return [];
  return res.json();
}

console.log('\n=== NEWEST INVOICES ===');
for (const r of await rows('invoices', 'invoice_number,total,status,created_at', 'created_at.desc')) {
  console.log(`   ${String(r.created_at).slice(0, 10)}  ${String(r.invoice_number).padEnd(12)} ${String(r.total).padStart(9)}  ${r.status}`);
}

console.log('\n=== OLDEST INVOICES ===');
for (const r of await rows('invoices', 'invoice_number,total,status,created_at', 'created_at.asc')) {
  console.log(`   ${String(r.created_at).slice(0, 10)}  ${String(r.invoice_number).padEnd(12)} ${String(r.total).padStart(9)}  ${r.status}`);
}

console.log('\n=== NEWEST CUSTOMERS (first names only) ===');
for (const r of await rows('customers', 'name,created_at', 'created_at.desc')) {
  const first = String(r.name ?? '').split(' ')[0];
  console.log(`   ${String(r.created_at).slice(0, 10)}  ${first}`);
}

console.log('\n=== NEWEST JOBS ===');
for (const r of await rows('jobs', 'service,scheduled_date,status,job_value', 'scheduled_date.desc')) {
  console.log(`   ${String(r.scheduled_date).slice(0, 10)}  ${String(r.service ?? '').slice(0, 24).padEnd(24)} ${String(r.job_value ?? '').padStart(8)}  ${r.status}`);
}
