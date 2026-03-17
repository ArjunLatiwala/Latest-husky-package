#!/bin/sh

# run-ci-checks.sh — Dynamic DevOps CI Checks
# Used by Husky pre-push

echo ""
echo "--------------------------------------------------"
echo "[CI Checks] Starting local CI pipeline"
echo "--------------------------------------------------"

# ---------------------------------------------------------------
# Detect changed files
# Case 1: Normal push — remote exists, diff against it
# Case 2: Initial push — only 1 commit, no HEAD~1, use empty tree
# Case 3: Local-only push — multiple commits, no remote yet
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
  if git rev-parse HEAD~1 >/dev/null 2>&1; then
    CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
  else
    EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    CHANGED=$(git diff-tree --no-commit-id -r --name-only "$EMPTY_TREE" HEAD 2>/dev/null)
    echo "[CI Checks] Initial push detected — scanning all committed files."
  fi
fi

if [ -z "$CHANGED" ]; then
  echo "[CI Checks] No changed files detected. Skipping."
  exit 0
fi

echo ""
echo "[CI Checks] Changed files detected:"
echo "$CHANGED" | sed "s/^/  -> /"

# ---------------------------------------------------------------
# Ignore trivial file types
# ---------------------------------------------------------------

SIGNIFICANT=$(echo "$CHANGED" | grep -Ev "\.md$|\.txt$|\.png$|\.jpg$|\.jpeg$|\.gif$|\.svg$|\.lock$|\.log$")

if [ -z "$SIGNIFICANT" ]; then
  echo "[CI Checks] Only docs/assets changed. Skipping heavy checks."
  exit 0
fi

echo "[CI Checks] Starting checks..."

# ---------------------------------------------------------------
# Detect backend/API related changes
# ---------------------------------------------------------------

API_CHANGE=$(echo "$CHANGED" | grep -E "\.js$|\.ts$|\.jsx$|\.tsx$|package\.json|routes/|controllers/|services/|server/|api/")

# ---------------------------------------------------------------
# Find Node project directory
# ---------------------------------------------------------------

find_project_dir() {
  for DIR in . backend server api app src frontend; do
    if [ -f "$DIR/package.json" ]; then
      echo "$DIR"
      return
    fi
  done
  echo "none"
}

PROJECT_DIR=$(find_project_dir)

if [ "$PROJECT_DIR" = "none" ]; then
  echo "[CI Checks] No package.json found. Skipping Node checks."
  exit 0
fi

echo "[CI Checks] Node project detected in: $PROJECT_DIR"
cd "$PROJECT_DIR" || exit 0

# ---------------------------------------------------------------
# Detect scripts dynamically
# ---------------------------------------------------------------

HAS_START=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.start?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)
HAS_DEV=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.dev?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)
HAS_TEST=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.test?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

# ---------------------------------------------------------------
# Skip smoke tests if no backend/API change
# ---------------------------------------------------------------

if [ -z "$API_CHANGE" ]; then
  echo "[CI Checks] No backend/API changes detected. Skipping smoke tests."
  exit 0
fi

# ---------------------------------------------------------------
# Determine start command
# ---------------------------------------------------------------

START_CMD=""
if [ "$HAS_START" = "yes" ]; then
  START_CMD="npm start"
elif [ "$HAS_DEV" = "yes" ]; then
  START_CMD="npm run dev"
fi

if [ -z "$START_CMD" ]; then
  echo "[Smoke Tests] No start/dev script found. Skipping."
  exit 0
fi

echo "[Smoke Tests] Starting server with: $START_CMD"

NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_MAJOR" -ge 17 ]; then
  export NODE_OPTIONS=--openssl-legacy-provider
fi

sh -c "$START_CMD" &
SERVER_PID=$!
SERVER_UP=0
sleep 2
# ---------------------------------------------------------------
# Dynamic port detection
# Priority: .env -> package.json scripts -> source files -> fallback
# ---------------------------------------------------------------

DETECTED_PORT=""

# 1. Check .env
if [ -f ".env" ]; then
  DETECTED_PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2 | tr -d "\t\r\n ")
  if [ -n "$DETECTED_PORT" ]; then
    echo "[Smoke Tests] Port found in .env: $DETECTED_PORT"
  fi
fi

# 2. Check package.json scripts for PORT=XXXX
if [ -z "$DETECTED_PORT" ]; then
  DETECTED_PORT=$(node -e 'try{const p=require("./package.json");const s=JSON.stringify(p.scripts||{});const m=s.match(/PORT=([0-9]+)/);if(m)process.stdout.write(m[1])}catch(e){}' 2>/dev/null)
  if [ -n "$DETECTED_PORT" ]; then
    echo "[Smoke Tests] Port found in package.json: $DETECTED_PORT"
  fi
fi

# 3. Scan source files for .listen(XXXX)
if [ -z "$DETECTED_PORT" ]; then
  DETECTED_PORT=$(grep -rE "\.listen\([0-9]" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | grep -oE "[0-9]{4,5}" | head -1)
  if [ -n "$DETECTED_PORT" ]; then
    echo "[Smoke Tests] Port found in source files: $DETECTED_PORT"
  fi
fi

# 4. Build port scan list — detected port first, then common fallbacks
if [ -n "$DETECTED_PORT" ]; then
  PORT_LIST="$DETECTED_PORT 3000 3001 4000 4200 5000 5001 8000 8080 8081 9000 1337"
else
  echo "[Smoke Tests] No port detected — scanning common ports."
  PORT_LIST="3000 3001 4000 4200 5000 5001 8000 8080 8081 9000 1337"
fi

# ---------------------------------------------------------------
# Wait for server to start
# ---------------------------------------------------------------

for i in $(seq 1 30); do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "[Smoke Tests] Server crashed early."
    break
  fi
  for PORT_TRY in $PORT_LIST; do
    if curl -sf http://localhost:$PORT_TRY >/dev/null 2>&1; then
      PORT=$PORT_TRY
      SERVER_UP=1
      echo "[Smoke Tests] Server running on port $PORT"
      break 2
    fi
  done
  echo "[Smoke Tests] Waiting for server... ($i/30)"
  sleep 1
done

if [ $SERVER_UP -eq 0 ]; then
  echo "[Smoke Tests] Server did not start. Skipping tests."
  kill $SERVER_PID 2>/dev/null
  exit 0
fi

# ---------------------------------------------------------------
# Run npm tests
# ---------------------------------------------------------------

if [ "$HAS_TEST" = "yes" ]; then
  if [ ! -d "node_modules" ]; then
    echo "[Smoke Tests] node_modules missing. Skipping npm test."
  else
    echo "[Smoke Tests] Running npm test..."
    npm test || {
      echo "[Smoke Tests] Tests failed. Push blocked."
      kill $SERVER_PID 2>/dev/null
      exit 1
    }
    echo "[Smoke Tests] Tests passed ✔"
  fi
else
  echo "[Smoke Tests] No test script found."
fi

# ---------------------------------------------------------------
# Newman API Tests — runs on every push including initial push
# ---------------------------------------------------------------

echo "[Newman] Searching for Postman collections..."

COLLECTIONS=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.postman_collection.json" 2>/dev/null)

if [ -z "$COLLECTIONS" ]; then
  echo "[Newman] No collections found. Skipping."
else
  if ! command -v newman >/dev/null 2>&1; then
    echo "[Newman] Installing newman..."
    npm install -g newman newman-reporter-htmlextra >/dev/null 2>&1 || true
  fi

  mkdir -p newman-reports

  ENV_FILE=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.postman_environment.json" 2>/dev/null | head -1)

  NEWMAN_FAIL=0

  for COLLECTION in $COLLECTIONS; do
    NAME=$(basename "$COLLECTION" .json)
    echo "[Newman] Running: $COLLECTION"

    ENV_FLAG=""
    if [ -n "$ENV_FILE" ]; then
      ENV_FLAG="--environment $ENV_FILE"
    fi

    newman run "$COLLECTION" \
      $ENV_FLAG \
      --env-var "baseUrl=http://localhost:${PORT:-3000}" \
      --reporters cli,htmlextra \
      --reporter-htmlextra-export "newman-reports/${NAME}-report.html" \
      --bail

    if [ $? -ne 0 ]; then
      NEWMAN_FAIL=1
    fi
  done

  if [ $NEWMAN_FAIL -ne 0 ]; then
    echo "[Newman] API tests failed. Push blocked."
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi

  echo "[Newman] All collections passed ✔"
fi

kill $SERVER_PID 2>/dev/null

echo "[CI Checks] All checks completed."
echo "--------------------------------------------------"

exit 0
