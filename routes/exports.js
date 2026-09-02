/**
 * Data export.
 *
 * Every table in the system, downloadable as CSV, plus a single JSON bundle
 * that contains the lot. This is deliberately one self-contained module with a
 * table-driven config rather than an export handler bolted onto each route
 * file — adding a dataset is a config entry, and the whole thing lifts into
 * another project in one piece.
 *
 * Routes:
 *   GET /admin/exports            list the available datasets (drives the UI)
 *   GET /admin/exports/all        every dataset in one JSON file
 *   GET /admin/exports/:dataset   one dataset as CSV
 */

const { parse } = require('json2csv');

const log = require('../services/logger').child('Exports');

let supabase = null;

function setSupabaseClient(client) {
  supabase = client;
}

/**
 * Supabase caps a single request at 1000 rows, so anything that reads a whole
 * table has to page or it silently truncates. A partial export is worse than
 * no export, because it looks like it worked.
 */
const PAGE_SIZE = 1000;

/**
 * The catalogue.
 *
 * `dateColumn` is the column the ?date_from / ?date_to filters apply to, where
 * filtering by date is meaningful. `softDelete` marks tables carrying a
 * deleted_at that should be hidden unless explicitly asked for.
 */
const DATASETS = {
  customers: {
    label: 'Customers',
    table: 'customers',
    group: 'crm',
    order: 'created_at',
    dateColumn: 'created_at'
  },
  quotes: {
    label: 'Quotes',
    table: 'quotes',
    group: 'crm',
    order: 'created_at',
    dateColumn: 'created_at',
    softDelete: true
  },
  quote_activity: {
    label: 'Quote activity log',
    table: 'quote_activity',
    group: 'crm',
    order: 'created_at',
    dateColumn: 'created_at'
  },
  jobs: {
    label: 'Jobs',
    table: 'jobs',
    group: 'operations',
    order: 'scheduled_date',
    dateColumn: 'scheduled_date'
  },
  recurring_jobs: {
    label: 'Recurring jobs',
    table: 'recurring_jobs',
    group: 'operations',
    order: 'created_at'
  },
  team: {
    label: 'Team members',
    table: 'team_members',
    group: 'operations',
    order: 'created_at'
  },
  invoices: {
    label: 'Invoices',
    table: 'invoices',
    group: 'money',
    order: 'created_at',
    dateColumn: 'created_at'
  },
  income: {
    label: 'Income',
    table: 'income_entries',
    group: 'money',
    order: 'date',
    dateColumn: 'date',
    softDelete: true
  },
  expenses: {
    label: 'Expenses',
    table: 'expenses',
    group: 'money',
    order: 'date',
    dateColumn: 'date',
    softDelete: true,
    // Join the category so the CSV carries the readable name and the HMRC
    // bucket, not just a UUID the accountant can do nothing with.
    select: '*, expense_categories(name, hmrc_category)'
  },
  expense_categories: {
    label: 'Expense categories',
    table: 'expense_categories',
    group: 'money',
    order: 'sort_order'
  },
  recurring_expenses: {
    label: 'Recurring expenses',
    table: 'recurring_expenses',
    group: 'money',
    order: 'created_at',
    softDelete: true
  },
  wages: {
    label: 'Wages',
    table: 'wage_payments',
    group: 'money',
    order: 'date',
    dateColumn: 'date',
    softDelete: true
  },
  mileage: {
    label: 'Mileage',
    table: 'mileage_log',
    group: 'money',
    order: 'date',
    dateColumn: 'date',
    softDelete: true
  },
  assets: {
    label: 'Capital assets',
    table: 'capital_assets',
    group: 'money',
    order: 'created_at'
  },
  tax_savings: {
    label: 'Tax savings',
    table: 'tax_savings',
    group: 'money',
    order: 'created_at'
  },
  finance_audit_log: {
    label: 'Finance audit log',
    table: 'finance_audit_log',
    group: 'money',
    order: 'created_at',
    dateColumn: 'created_at'
  },
  chats: {
    label: 'Chat conversations',
    table: 'chat_conversations',
    group: 'system',
    order: 'created_at',
    dateColumn: 'created_at'
  },
  pricing_history: {
    label: 'Pricing history',
    table: 'pricing_history',
    group: 'system',
    order: 'created_at'
  },
  settings: {
    label: 'Settings',
    table: 'settings',
    group: 'system',
    order: 'key'
  }
};

/**
 * Read a whole table, paging until the rows run out.
 */
async function fetchAll(config, { dateFrom, dateTo, includeDeleted } = {}) {
  const rows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from(config.table)
      .select(config.select || '*')
      .order(config.order || 'created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (config.softDelete && !includeDeleted) query = query.is('deleted_at', null);
    if (config.dateColumn && dateFrom) query = query.gte(config.dateColumn, dateFrom);
    if (config.dateColumn && dateTo) query = query.lte(config.dateColumn, dateTo);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

/**
 * Postgres arrays and jsonb arrive as real JavaScript values. A CSV cell can
 * only hold text, so they get stringified — the alternative is "[object
 * Object]" in a spreadsheet, which loses the data outright.
 */
function flattenRow(row) {
  const flat = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      flat[key] = '';
    } else if (Array.isArray(value) && value.every(v => typeof v !== 'object' || v === null)) {
      // Simple arrays (services, tags) read far better as "a, b, c".
      flat[key] = value.join(', ');
    } else if (typeof value === 'object') {
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = value;
    }
  }

  return flat;
}

function sendCsv(res, rows, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (rows.length === 0) {
    // A header-less empty file is indistinguishable from a failed download,
    // so say so in the file itself.
    return res.send('No data');
  }

  return res.send(parse(rows.map(flattenRow)));
}

function stamp() {
  return new Date().toISOString().split('T')[0];
}

/**
 * GET /admin/exports
 * Lists what can be exported, so the dashboard doesn't hardcode the catalogue.
 */
async function listDatasets(req, res) {
  const datasets = Object.entries(DATASETS).map(([key, config]) => ({
    key,
    label: config.label,
    group: config.group,
    supportsDateRange: Boolean(config.dateColumn)
  }));

  res.json({ success: true, datasets });
}

/**
 * GET /admin/exports/all
 * Every dataset in one JSON file. This is the backup, and the migration
 * source if this data ever moves to another system.
 */
async function exportAll(req, res) {
  try {
    const { date_from: dateFrom, date_to: dateTo, include_deleted: includeDeleted } = req.query;
    const options = { dateFrom, dateTo, includeDeleted: includeDeleted === '1' };

    const bundle = {
      exportedAt: new Date().toISOString(),
      business: process.env.BUSINESS_NAME || 'Revive',
      filters: { dateFrom: dateFrom || null, dateTo: dateTo || null, includeDeleted: options.includeDeleted },
      tables: {}
    };

    let total = 0;

    for (const [key, config] of Object.entries(DATASETS)) {
      try {
        const rows = await fetchAll(config, options);
        bundle.tables[key] = { table: config.table, rows: rows.length, data: rows };
        total += rows.length;
      } catch (error) {
        // One missing table must not cost you the other eighteen.
        log.warn('Dataset skipped during full export', { dataset: key, error: error.message });
        bundle.tables[key] = { table: config.table, rows: null, error: error.message, data: [] };
      }
    }

    bundle.totalRows = total;

    log.info('Full data export', { totalRows: total, datasets: Object.keys(bundle.tables).length });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="revive-backup-${stamp()}.json"`);
    res.send(JSON.stringify(bundle, null, 2));

  } catch (error) {
    log.error('Full export failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Export failed: ' + error.message });
  }
}

/**
 * GET /admin/exports/:dataset
 * One dataset as CSV.
 */
async function exportDataset(req, res) {
  const key = req.params.dataset;
  const config = DATASETS[key];

  if (!config) {
    return res.status(404).json({
      success: false,
      error: `Unknown dataset "${key}". Available: ${Object.keys(DATASETS).join(', ')}`
    });
  }

  try {
    const { date_from: dateFrom, date_to: dateTo, include_deleted: includeDeleted } = req.query;

    const rows = await fetchAll(config, {
      dateFrom,
      dateTo,
      includeDeleted: includeDeleted === '1'
    });

    log.info('Dataset exported', { dataset: key, rows: rows.length });

    sendCsv(res, rows, `revive-${key}-${stamp()}.csv`);

  } catch (error) {
    log.error('Dataset export failed', { dataset: key, error: error.message });
    res.status(500).json({ success: false, error: 'Export failed: ' + error.message });
  }
}

module.exports = {
  setSupabaseClient,
  listDatasets,
  exportAll,
  exportDataset,
  DATASETS
};
