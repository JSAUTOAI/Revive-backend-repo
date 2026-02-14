#!/bin/bash
# Test production estimation engine
# Run this after Railway deployment completes

echo "🧪 Testing production estimation engine..."
echo ""

curl -X POST https://revive-backend-repo-production.up.railway.app/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Test Customer",
    "email": "production-test@example.com",
    "phone": "07111222333",
    "addressLine1": "789 Production Street",
    "postcode": "SW1A 1AA",
    "preferredContact": "phone",
    "bestTime": "morning",
    "remindersOk": true,
    "formVersion": "1.0",
    "services": ["roof", "gutter"],
    "answers": {
      "propertyType": "Detached house",
      "roughSize": "large",
      "lastCleaned": "over a year ago",
      "specificDetails": "Moss buildup on roof",
      "accessNotes": "Good access from driveway"
    }
  }'

echo ""
echo ""
echo "✅ If you see 'success: true', the quote was submitted!"
echo "📊 Now check Supabase to verify estimation data was calculated"
echo ""
echo "SQL to run in Supabase:"
echo "SELECT name, email, services, estimated_value_min, estimated_value_max, lead_score, qualification_status"
echo "FROM quotes"
echo "WHERE email = 'production-test@example.com';"
