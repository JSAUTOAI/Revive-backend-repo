/**
 * Google Sheets Integration
 *
 * Automatically syncs quote submissions to Google Sheets for easy tracking and analysis.
 * Uses service account authentication for secure, automated access.
 */

const { google } = require('googleapis');
const path = require('path');

// Initialize Google Sheets API
let sheets;
let auth;

/**
 * Initialize Google Sheets client
 */
async function initializeSheets() {
  try {
    // Support two methods of authentication:
    // 1. Environment variable with JSON credentials (for Railway/production)
    // 2. File path to credentials (for local development)

    let authConfig;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      // Production: Use credentials from environment variable
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      // Local development: Use credentials file
      const credentialsPath = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || './credentials/google-service-account.json');
      auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }

    // Create sheets client
    sheets = google.sheets({ version: 'v4', auth });

    console.log('[Google Sheets] ✅ Initialized successfully');
    return true;
  } catch (error) {
    console.error('[Google Sheets] ❌ Failed to initialize:', error.message);
    return false;
  }
}

/**
 * Sync quote data to Google Sheets
 *
 * @param {Object} quote - Quote data from database
 * @returns {Promise<Object>} - Result object with success status
 */
async function syncQuoteToSheets(quote) {
  try {
    // Initialize if not already done
    if (!sheets) {
      const initialized = await initializeSheets();
      if (!initialized) {
        return { success: false, error: 'Failed to initialize Google Sheets' };
      }
    }

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!spreadsheetId) {
      console.error('[Google Sheets] GOOGLE_SPREADSHEET_ID not set in .env');
      return { success: false, error: 'Spreadsheet ID not configured' };
    }

    // Format data for spreadsheet row
    const row = [
      // Timestamp
      new Date(quote.created_at).toLocaleString('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),

      // Customer Details
      quote.name || '',
      quote.email || '',
      quote.phone || '',
      quote.address_line1 || '',
      quote.postcode || '',

      // Services (array to comma-separated)
      Array.isArray(quote.services) ? quote.services.join(', ') : '',

      // Preferences
      quote.preferred_contact || '',
      quote.best_time || '',
      quote.reminders_ok ? 'Yes' : 'No',

      // Estimates (will be populated later by estimation job)
      quote.estimated_value_min || '',
      quote.estimated_value_max || '',
      quote.lead_score || '',
      quote.qualification_status || '',

      // Status
      quote.status || 'new',

      // Customer Acceptance
      quote.customer_accepted_estimate ? 'Yes' : 'No',
      quote.customer_accepted_at ? new Date(quote.customer_accepted_at).toLocaleString('en-GB') : '',

      // Common answer fields
      quote.answers?.propertyType || '',
      quote.answers?.roughSize || '',
      quote.answers?.lastCleaned || '',
      quote.answers?.specificDetails || '',
      quote.answers?.accessNotes || '',

      // Quote ID (for reference)
      quote.id || ''
    ];

    // Append row to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:W', // Columns A through W (23 columns)
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row]
      }
    });

    console.log(`[Google Sheets] ✅ Quote ${quote.id} synced to row ${response.data.updates.updatedRange}`);

    return {
      success: true,
      range: response.data.updates.updatedRange,
      rowsAdded: response.data.updates.updatedRows
    };

  } catch (error) {
    console.error('[Google Sheets] ❌ Failed to sync quote:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize sheet with headers (run once)
 * Call this manually if sheet is empty
 */
async function setupSheetHeaders() {
  try {
    if (!sheets) {
      await initializeSheets();
    }

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    const headers = [
      'Timestamp',
      'Name',
      'Email',
      'Phone',
      'Address',
      'Postcode',
      'Services',
      'Preferred Contact',
      'Best Time',
      'Reminders OK',
      'Estimated Min (£)',
      'Estimated Max (£)',
      'Lead Score',
      'Qualification',
      'Status',
      'Customer Accepted',
      'Accepted At',
      'Property Type',
      'Rough Size',
      'Last Cleaned',
      'Specific Details',
      'Access Notes',
      'Quote ID'
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1:W1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers]
      }
    });

    console.log('[Google Sheets] ✅ Headers set up successfully');
    return { success: true };

  } catch (error) {
    console.error('[Google Sheets] ❌ Failed to set up headers:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update existing row with estimation data
 *
 * @param {string} quoteId - Quote ID to find
 * @param {Object} updates - Fields to update (estimated_value_min, estimated_value_max, lead_score, qualification_status)
 */
async function updateQuoteInSheets(quoteId, updates) {
  try {
    if (!sheets) {
      await initializeSheets();
    }

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    // Find the row with this quote ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!W:W', // Column W contains quote IDs
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === quoteId);

    if (rowIndex === -1) {
      console.log(`[Google Sheets] Quote ${quoteId} not found in sheet`);
      return { success: false, error: 'Quote not found in sheet' };
    }

    // Row number (1-indexed, +1 for header)
    const rowNumber = rowIndex + 1;

    // Update specific columns (K=11, L=12, M=13, N=14)
    const updateRequests = [];

    if (updates.estimated_value_min !== undefined) {
      updateRequests.push({
        range: `Sheet1!K${rowNumber}`,
        values: [[updates.estimated_value_min]]
      });
    }

    if (updates.estimated_value_max !== undefined) {
      updateRequests.push({
        range: `Sheet1!L${rowNumber}`,
        values: [[updates.estimated_value_max]]
      });
    }

    if (updates.lead_score !== undefined) {
      updateRequests.push({
        range: `Sheet1!M${rowNumber}`,
        values: [[updates.lead_score]]
      });
    }

    if (updates.qualification_status !== undefined) {
      updateRequests.push({
        range: `Sheet1!N${rowNumber}`,
        values: [[updates.qualification_status]]
      });
    }

    if (updates.customer_accepted_estimate !== undefined) {
      updateRequests.push({
        range: `Sheet1!P${rowNumber}`,
        values: [[updates.customer_accepted_estimate ? 'Yes' : 'No']]
      });
    }

    if (updates.customer_accepted_at) {
      updateRequests.push({
        range: `Sheet1!Q${rowNumber}`,
        values: [[new Date(updates.customer_accepted_at).toLocaleString('en-GB')]]
      });
    }

    // Batch update all fields
    if (updateRequests.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateRequests
        }
      });

      console.log(`[Google Sheets] ✅ Updated quote ${quoteId} at row ${rowNumber}`);
    }

    return { success: true, rowNumber };

  } catch (error) {
    console.error('[Google Sheets] ❌ Failed to update quote:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  initializeSheets,
  syncQuoteToSheets,
  updateQuoteInSheets,
  setupSheetHeaders
};
