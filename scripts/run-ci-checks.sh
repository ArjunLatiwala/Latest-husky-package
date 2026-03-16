#!/bin/sh

# ---------------------------------------------------------------
# run-ci-checks.sh — Smoke Tests + Newman API Tests
# ---------------------------------------------------------------

# ---------------------------------------------------------------
# Git diff check — only run if actual files changed
# ---------------------------------------------------------------
LOCAL=$(git rev-parse @ 2>/dev/null)
REMOTE=$(git rev-parse @{u} 2>/dev/null)

if [ "$REMOTE" != "" ] && [ "$LOCAL" = "$REMOTE" ]; then
  echo "[CI Checks] No changes to push. Skipping."
  exit 0
fi

if [ "$REMOTE" != "" ]; then
  CHANGED=$(git diff --name-only "$REMOTE" "$LOCAL" 2>/dev/null)
else
  CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
fi

if [ -z "$CHANGED" ]; then
  echo "[CI Checks] No changed files detected. Skipping."
  exit 0
fi

echo ""
echo "[CI Checks] Changed files detected:"
echo "$CHANGED" | sed 's/^/  -> /'
echo ""
echo "[CI Checks] Starting checks..."

# ---------------------------------------------------------------
# Auto-detect start command
# Priority: start > backend > server > api > dev
# dev is checked LAST because it often runs multiple processes
# (frontend + backend together via concurrently) which breaks smoke tests
# Also searches common subfolders if no package.json at root
# ---------------------------------------------------------------
find_start_cmd() {
  PKG_DIR=$1
  for SCRIPT in start backend server api dev; do
    HAS=$(node -e "try{const p=require('./$PKG_DIR/package.json');console.log(p.scripts&&p.scripts['$SCRIPT']?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)
    if [ "$HAS" = "yes" ]; then
      echo "$SCRIPT"
      return
    fi
  done
  echo "none"
}

find_project_with_start() {
  for DIR in . backend server api app; do
    if [ -f "$DIR/package.json" ]; then
      CMD=$(find_start_cmd "$DIR")
      if [ "$CMD" != "none" ]; then
        echo "$DIR:$CMD"
        return
      fi
    fi
  done
  echo "none"
}

RESULT=$(find_project_with_start)

if [ "$RESULT" = "none" ]; then
  echo "[Smoke Tests] No runnable start script found anywhere. Skipping smoke tests."
else
  PROJECT_DIR=$(echo "$RESULT" | cut -d':' -f1)
  START_CMD=$(echo "$RESULT" | cut -d':' -f2)

  echo "[Smoke Tests] Found '$START_CMD' script in: $PROJECT_DIR"

  # cd into project dir so npm commands work correctly
  cd "$PROJECT_DIR" || exit 1

  # ---------------------------------------------------------------
  # Smoke Tests — start server + auto-detect port
  # ---------------------------------------------------------------
  echo ""
  echo "[Smoke Tests] Starting server with: npm run $START_CMD"

  npm run $START_CMD &
  SERVER_PID=$!

  SERVER_UP=0
  for i in $(seq 1 30); do
    # Detect server crash early — no point waiting 30s if process already died
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      echo "[Smoke Tests] Server process crashed — skipping smoke tests."
      SERVER_UP=0
      break
    fi

    # Try all common ports
    for PORT_TRY in 3000 5000 8000 8080 4000 4200 3001 8081 1337 5001 6000 7000; do
      if curl -sf http://localhost:$PORT_TRY > /dev/null 2>&1; then
        PORT=$PORT_TRY
        SERVER_UP=1
        echo "[Smoke Tests] Server is up on port $PORT."
        break 2
      fi
    done

    echo "[Smoke Tests] Waiting for server... ($i/30)"
    sleep 1
  done

  if [ $SERVER_UP -eq 0 ]; then
    echo "[Smoke Tests] Server did not start in time — skipping smoke tests."
    kill $SERVER_PID 2>/dev/null
  else

    # Check for test script
    HAS_TEST=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.test?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

    if [ "$HAS_TEST" = "no" ]; then
      echo "[Smoke Tests] No test script found — skipping npm test."
    else
      echo "[Smoke Tests] Running npm test..."
      npm test
      SMOKE_EXIT=$?

      if [ $SMOKE_EXIT -ne 0 ]; then
        kill $SERVER_PID 2>/dev/null
        echo "[Smoke Tests] Failed. Push blocked."
        exit 1
      fi

      echo "[Smoke Tests] Passed. ✔"
    fi

    # ---------------------------------------------------------------
    # Newman API Tests
    # ---------------------------------------------------------------
    echo ""
    echo "[Newman] Looking for Postman collections..."

    COLLECTIONS=$(find . \
      -not -path '*/node_modules/*' \
      -not -path '*/.git/*' \
      -not -path '*/scripts/*' \
      \( -name "*.postman_collection.json" -o -name "collection.json" \) \
      2>/dev/null)

    if [ -z "$COLLECTIONS" ]; then
      echo "[Newman] No Postman collection found. Skipping."
      kill $SERVER_PID 2>/dev/null
    else

      if ! command -v newman > /dev/null 2>&1; then
        echo "[Newman] Installing newman..."
        npm install -g newman newman-reporter-htmlextra 2>/dev/null || true
      fi

      mkdir -p newman-reports

      ENV_FILE=$(find . \
        -not -path '*/node_modules/*' \
        -not -path '*/.git/*' \
        -name "*.postman_environment.json" \
        2>/dev/null | head -1)

      NEWMAN_EXIT=0
      for COLLECTION in $COLLECTIONS; do
        REPORT_NAME=$(basename "$COLLECTION" .json)
        echo "[Newman] Running: $COLLECTION"

        ENV_FLAG=""
        if [ -n "$ENV_FILE" ]; then
          ENV_FLAG="--environment $ENV_FILE"
        fi

        newman run "$COLLECTION" \
          $ENV_FLAG \
          --env-var "baseUrl=http://localhost:${PORT:-3000}" \
          --reporters cli,htmlextra \
          --reporter-htmlextra-export "newman-reports/${REPORT_NAME}-report.html" \
          --bail

        if [ $? -ne 0 ]; then
          NEWMAN_EXIT=1
        fi
      done

      kill $SERVER_PID 2>/dev/null

      if [ $NEWMAN_EXIT -ne 0 ]; then
        echo "[Newman] One or more collections failed. Push blocked."
        exit 1
      fi

      echo "[Newman] All collections passed. ✔"
    fi
  fi
fi

exit 0
