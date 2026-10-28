#!/bin/sh
set -e

if [ "${SKIP_DB_SETUP}" = "true" ]; then
  echo "Skipping database setup (SKIP_DB_SETUP=true)."
else
  echo "Running database setup..."
  pnpm --filter @cio/db db:setup
  echo "Database setup complete."
fi

echo "Starting API..."
# exec node directly (not via pnpm): the API must be PID 1 so docker's SIGTERM reaches it and it can drain
# in-flight requests (see apps/api/src/shutdown.ts). `pnpm --filter @cio/api start` is `node dist/index.js` in apps/api.
cd /app/apps/api
exec node dist/index.js
