/**
 * Setup Google Sheets Headers
 *
 * Run this script once to initialize your Google Sheet with the correct headers.
 *
 * Usage: node scripts/setupGoogleSheets.js
 */

require('dotenv').config();
const { setupSheetHeaders } = require('../services/googleSheets');

async function main() {
  console.log('🔧 Setting up Google Sheets headers...\n');

  console.log('Spreadsheet ID:', process.env.GOOGLE_SPREADSHEET_ID);
  console.log('Credentials Path:', process.env.GOOGLE_CREDENTIALS_PATH);
  console.log('');

  const result = await setupSheetHeaders();

  if (result.success) {
    console.log('✅ Google Sheets headers set up successfully!');
    console.log('\nYour sheet now has the following columns:');
    console.log('  1. Timestamp');
    console.log('  2. Name');
    console.log('  3. Email');
    console.log('  4. Phone');
    console.log('  5. Address');
    console.log('  6. Postcode');
    console.log('  7. Services');
    console.log('  8. Preferred Contact');
    console.log('  9. Best Time');
    console.log(' 10. Reminders OK');
    console.log(' 11. Estimated Min (£)');
    console.log(' 12. Estimated Max (£)');
    console.log(' 13. Lead Score');
    console.log(' 14. Qualification');
    console.log(' 15. Status');
    console.log(' 16. Customer Accepted');
    console.log(' 17. Accepted At');
    console.log(' 18. Property Type');
    console.log(' 19. Rough Size');
    console.log(' 20. Last Cleaned');
    console.log(' 21. Specific Details');
    console.log(' 22. Access Notes');
    console.log(' 23. Quote ID');
    console.log('\n✨ You\'re all set! New quotes will automatically sync to this sheet.');
  } else {
    console.error('❌ Failed to set up headers:', result.error);
    console.error('\nPlease check:');
    console.error('  - Your credentials file exists at:', process.env.GOOGLE_CREDENTIALS_PATH);
    console.error('  - The service account has edit access to the spreadsheet');
    console.error('  - The spreadsheet ID is correct:', process.env.GOOGLE_SPREADSHEET_ID);
    process.exit(1);
  }
}

main();
