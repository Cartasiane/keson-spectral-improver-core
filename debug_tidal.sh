#!/bin/bash
source .env

echo "Getting Token..."
TOKEN_RESP=$(curl -s -X POST "https://auth.tidal.com/v1/oauth2/token" \
  -u "$TIDAL_CLIENT_ID:$TIDAL_CLIENT_SECRET" \
  -d "grant_type=client_credentials")

ACCESS_TOKEN=$(echo $TOKEN_RESP | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Auth failed: $TOKEN_RESP"
  exit 1
fi

echo "Token obtained."

# Test 6: /albums/1 (No v2)
echo "--- Test 6: https://openapi.tidal.com/albums/1 ---"
curl -s -v "https://openapi.tidal.com/albums/1?countryCode=US" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/vnd.tidal.v1+json"

# Test 7: /search with basic Accept
echo -e "\n\n--- Test 7: https://openapi.tidal.com/search (Basic Accept) ---"
curl -s -v "https://openapi.tidal.com/search?query=Daft%20Punk&type=TRACKS&countryCode=US&limit=1" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json"

# Test 8: /v2/search with basic Accept
echo -e "\n\n--- Test 8: https://openapi.tidal.com/v2/search (Basic Accept) ---"
curl -s -v "https://openapi.tidal.com/v2/search?query=Daft%20Punk&type=TRACKS&countryCode=US&limit=1" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json"
