#!/usr/bin/env bash
# Runs the API against the ISOLATED test database (see .env.test), on its own port.
#
# Use this for any verification that creates, edits or deletes rows. Running
# those against the dev database corrupts real data: stock and average-cost
# figures in particular cannot be recovered afterwards, because nothing records
# what they were before.
#
#   bash scripts/test-api.sh
#
# Confirm which database is being served before mutating anything:
#   curl -s localhost:4100/api/v1/admin/vendors -H "Authorization: Bearer <token>"
set -euo pipefail

if [ ! -f .env.test ]; then
  echo "No .env.test - copy the block from docs and point it at a SEPARATE database." >&2
  exit 1
fi

if grep -qE 'DATABASE_URL=.*/RetailShop\?' .env.test; then
  echo "REFUSING TO START: .env.test points at the dev database (RetailShop)." >&2
  exit 1
fi

set -a
. ./.env.test
set +a

exec npx ts-node -r tsconfig-paths/register src/main.ts
