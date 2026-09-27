#!/bin/sh
set -e

# =============================================================================
# FieldOps API Container Entrypoint
# =============================================================================

# If RUN_MIGRATIONS is set, apply pending Prisma migrations before starting
if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "=> Running database migrations (prisma migrate deploy)..."
  npx prisma migrate deploy
fi

# Support shorthand commands
case "$1" in
  # Run pending database migrations and exit
  migrate|db:deploy)
    echo "=> Executing prisma migrate deploy..."
    exec npx prisma migrate deploy
    ;;

  # Check database migration status and exit
  db:status)
    echo "=> Executing prisma migrate status..."
    exec npx prisma migrate status
    ;;

  # Bootstrap user role, e.g.:
  # docker run <image> user:set-role root@example.com SUPER_ADMIN
  user:set-role)
    shift
    echo "=> Executing scripts/set-role.mjs..."
    exec node scripts/set-role.mjs "$@"
    ;;

  # Default API start command
  api)
    shift
    echo "=> Starting FieldOps API..."
    exec node dist/main.js "$@"
    ;;

  # Any other custom command passed to docker run
  *)
    exec "$@"
    ;;
esac
