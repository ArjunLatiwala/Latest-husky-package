'use strict';

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const { logInfo, logSuccess, logError } = require('./logger');

const TEMPLATE_PATH = path.resolve(__dirname, '../templates/ci-tests.yml');

exports.setupCIScript = async (gitRoot) => {
  const scriptsDir = path.join(process.cwd(), 'scripts');
  const scriptPath = path.join(scriptsDir, 'run-ci-checks.sh');

  await fs.ensureDir(scriptsDir);

  if (await fs.pathExists(scriptPath)) {
    logInfo("run-ci-checks.sh already exists — overwriting with latest version.");
  } else {
    logInfo("Creating scripts/run-ci-checks.sh...");
  }

  await fs.writeFile(scriptPath, buildCIScript());
  await fs.chmod(scriptPath, 0o755);
  logSuccess("scripts/run-ci-checks.sh created.");
  logInfo("To move tests to pre-commit in future: add './scripts/run-ci-checks.sh' to .husky/pre-commit.");
};

exports.setupPrePushHook = async (gitRoot) => {
  const huskyDir = path.join(gitRoot, '.husky');
  const hookPath = path.join(huskyDir, 'pre-push');

  if (!await fs.pathExists(huskyDir)) {
    logInfo("Husky directory not found. Skipping pre-push hook setup.");
    return;
  }

  const projectDir = path.relative(gitRoot, process.cwd()) || '.';

  if (await fs.pathExists(hookPath)) {
    logInfo("Pre-push hook already configured. Overwriting with latest setup...");
  } else {
    logInfo("Creating new pre-push hook...");
  }

  await fs.writeFile(hookPath, buildPrePushHook(projectDir));
  await fs.chmod(hookPath, 0o755);
  logSuccess("Pre-push hook created — calls scripts/run-ci-checks.sh.");
};

exports.setupCIWorkflow = async () => {
  const targetDir = path.join(process.cwd(), '.github', 'workflows');
  const targetFile = path.join(targetDir, 'ci-tests.yml');

  if (!await fs.pathExists(TEMPLATE_PATH)) {
    logError("CI template not found. Please reinstall the package.");
    return;
  }

  await fs.ensureDir(targetDir);

  if (await fs.pathExists(targetFile)) {
    logInfo("ci-tests.yml already exists — overwriting with latest version.");
  } else {
    logInfo("Creating .github/workflows/ci-tests.yml...");
  }

  await fs.copy(TEMPLATE_PATH, targetFile);
  logSuccess("GitHub Actions workflow copied to .github/workflows/ci-tests.yml");
};

exports.ensureProjectScripts = async () => {
  const pkgPath = path.join(process.cwd(), 'package.json');

  if (!await fs.pathExists(pkgPath)) {
    logError("No package.json found. Skipping script standardization.");
    return;
  }

  const { readJSON, writeJSON } = require('./utils');
  const pkg = await readJSON(pkgPath);
  if (!pkg.scripts) pkg.scripts = {};
  let changed = false;

  // 1. Standardize 'test' script
  const currentTest = pkg.scripts.test || '';
  if (!currentTest || currentTest.includes('no test specified')) {
    // If it's a Vite project, use vitest, else use node --test
    const isVite = pkg.dependencies?.vite || pkg.devDependencies?.vite;
    pkg.scripts.test = isVite ? 'vitest run' : 'node --test';
    logInfo(`Standardizing "test" script -> ${pkg.scripts.test}`);
    changed = true;
  }

  // 1b. Ensure 'check-hooks' is run before tests and start
  const checkCmd = 'npx cs-setup check-hooks && ';
  ['test', 'start'].forEach(s => {
    if (pkg.scripts[s] && !pkg.scripts[s].includes('cs-setup check-hooks')) {
      pkg.scripts[s] = checkCmd + pkg.scripts[s];
      changed = true;
    }
  });

  // 2. Standardize 'start' script if missing
  if (!pkg.scripts.start) {
    const startGuess = pkg.scripts.backend || pkg.scripts.server || pkg.scripts.api || pkg.scripts.dev;
    if (startGuess) {
      pkg.scripts.start = pkg.scripts[startGuess];
      logInfo(`Mapping "start" script to "${startGuess}"`);
      changed = true;
    } else {
      // Fallback: check if index.js or server.js exists
      if (await fs.pathExists('index.js')) {
        pkg.scripts.start = 'node index.js';
        changed = true;
      } else if (await fs.pathExists('server.js')) {
        pkg.scripts.start = 'node server.js';
        changed = true;
      }
    }
  }

  if (changed) {
    await writeJSON(pkgPath, pkg);
    logSuccess("package.json scripts standardized.");
  }
};

exports.ensurePackageLock = async () => {
  const lockPath = path.join(process.cwd(), 'package-lock.json');
  const yarnPath = path.join(process.cwd(), 'yarn.lock');

  logInfo("Generating/Updating package-lock.json (always overwrite)...");

  logInfo("No package-lock.json found — running npm install to generate it...");
  try {
    execSync('npm install', { stdio: 'inherit', cwd: process.cwd() });
    logSuccess("package-lock.json generated. Remember to commit it.");
  } catch {
    logError("Failed to generate package-lock.json. Run npm install manually.");
  }
};

function buildPrePushHook(projectDir) {
  const cdLine = projectDir !== '.' ? `cd "${projectDir}"` : '';
  return `#!/bin/sh

# Pre-push hook — runs from git root
${cdLine ? cdLine + '\n' : ''}
# Ensure hooks and configs are fresh (registry-safe)
if [ -f "./node_modules/.bin/cs-setup" ]; then
  ./node_modules/.bin/cs-setup check-hooks
elif [ -f "./node_modules/cs-setup/bin/index.js" ]; then
  node "./node_modules/cs-setup/bin/index.js" check-hooks
else
  npx --no-install cs-setup check-hooks 2>/dev/null || true
fi

./scripts/run-ci-checks.sh
`;
}

function buildCIScript() {
  return `#!/bin/sh

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
  PKG_DIR=\$1
  for SCRIPT in start backend server api dev; do
    HAS=\$(node -e "try{const p=require('./$PKG_DIR/package.json');console.log(p.scripts&&p.scripts['\$SCRIPT']?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)
    if [ "\$HAS" = "yes" ]; then
      echo "\$SCRIPT"
      return
    fi
  done
  echo "none"
}

find_project_with_start() {
  for DIR in . backend server api app; do
    if [ -f "\$DIR/package.json" ]; then
      CMD=\$(find_start_cmd "\$DIR")
      if [ "\$CMD" != "none" ]; then
        echo "\$DIR:\$CMD"
        return
      fi
    fi
  done
  echo "none"
}

RESULT=\$(find_project_with_start)

if [ "\$RESULT" = "none" ]; then
  echo "[Smoke Tests] No runnable start script found anywhere. Skipping smoke tests."
else
  PROJECT_DIR=\$(echo "\$RESULT" | cut -d':' -f1)
  START_CMD=\$(echo "\$RESULT" | cut -d':' -f2)

  echo "[Smoke Tests] Found '\$START_CMD' script in: \$PROJECT_DIR"

  # cd into project dir so npm commands work correctly
  cd "\$PROJECT_DIR" || exit 1

  # ---------------------------------------------------------------
  # Smoke Tests — start server + auto-detect port
  # ---------------------------------------------------------------
  echo ""
  echo "[Smoke Tests] Starting server with: npm run \$START_CMD"

  npm run \$START_CMD &
  SERVER_PID=\$!

  SERVER_UP=0
  for i in \$(seq 1 30); do
    # Detect server crash early — no point waiting 30s if process already died
    if ! kill -0 \$SERVER_PID 2>/dev/null; then
      echo "[Smoke Tests] Server process crashed — skipping smoke tests."
      SERVER_UP=0
      break
    fi

    # Try all common ports
    for PORT_TRY in 3000 5000 8000 8080 4000 4200 3001 8081 1337 5001 6000 7000 5173; do
      if curl -sf http://localhost:\$PORT_TRY > /dev/null 2>&1; then
        PORT=\$PORT_TRY
        SERVER_UP=1
        echo "[Smoke Tests] Server is up on port \$PORT."
        break 2
      fi
    done

    echo "[Smoke Tests] Waiting for server... (\$i/30)"
    sleep 1
  done

  if [ \$SERVER_UP -eq 0 ]; then
    echo "[Smoke Tests] Server did not start in time — skipping smoke tests."
    kill \$SERVER_PID 2>/dev/null
  else

    # Check for test script
    HAS_TEST=\$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.test?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

    if [ "\$HAS_TEST" = "no" ]; then
      echo "[Smoke Tests] No test script found — skipping npm test."
    else
      echo "[Smoke Tests] Running npm test..."
      npm test
      SMOKE_EXIT=\$?

      if [ \$SMOKE_EXIT -ne 0 ]; then
        kill \$SERVER_PID 2>/dev/null
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

    COLLECTIONS=\$(find . \\
      -not -path '*/node_modules/*' \\
      -not -path '*/.git/*' \\
      -not -path '*/scripts/*' \\
      \\( -name "*.postman_collection.json" -o -name "collection.json" \\) \\
      2>/dev/null)

    if [ -z "\$COLLECTIONS" ]; then
      echo "[Newman] No Postman collection found. Skipping."
      kill \$SERVER_PID 2>/dev/null
    else

      if ! command -v newman > /dev/null 2>&1; then
        echo "[Newman] Installing newman..."
        npm install -g newman newman-reporter-htmlextra 2>/dev/null || true
      fi

      mkdir -p newman-reports

      ENV_FILE=\$(find . \\
        -not -path '*/node_modules/*' \\
        -not -path '*/.git/*' \\
        -name "*.postman_environment.json" \\
        2>/dev/null | head -1)

      NEWMAN_EXIT=0
      for COLLECTION in \$COLLECTIONS; do
        REPORT_NAME=\$(basename "\$COLLECTION" .json)
        echo "[Newman] Running: \$COLLECTION"

        ENV_FLAG=""
        if [ -n "\$ENV_FILE" ]; then
          ENV_FLAG="--environment \$ENV_FILE"
        fi

        newman run "\$COLLECTION" \\
          \$ENV_FLAG \\
          --env-var "baseUrl=http://localhost:\${PORT:-3000}" \\
          --reporters cli,htmlextra \\
          --reporter-htmlextra-export "newman-reports/\${REPORT_NAME}-report.html" \\
          --bail

        if [ \$? -ne 0 ]; then
          NEWMAN_EXIT=1
        fi
      done

      kill \$SERVER_PID 2>/dev/null

      if [ \$NEWMAN_EXIT -ne 0 ]; then
        echo "[Newman] One or more collections failed. Push blocked."
        exit 1
      fi

      echo "[Newman] All collections passed. ✔"
    fi
  fi
fi

exit 0
`;
}