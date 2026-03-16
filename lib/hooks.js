'use strict';

const fs = require('fs-extra');
const path = require('path');
const { logInfo, logSuccess } = require('./logger');

/**
 * setupPreCommitHook(gitRoot)
 *
 * gitRoot     – directory containing .git  (where .husky/ lives)
 * process.cwd() – the Node.js project root  (where package.json / .tools / sonar-project.properties live)
 *
 * In a monorepo these two differ, e.g.:
 *   gitRoot     = /home/user/Pizza-Fleet
 *   projectRoot = /home/user/Pizza-Fleet/server
 *
 * The hook is written into gitRoot/.husky/pre-commit but must cd into
 * projectRoot before running any checks so every relative path resolves
 * correctly (node_modules, .tools, sonar-project.properties, etc.)
 */
exports.setupPreCommitHook = async (gitRoot) => {
  const projectRoot = process.cwd();
  const huskyDir = path.join(gitRoot || projectRoot, '.husky');
  const hookPath = path.join(huskyDir, 'pre-commit');

  if (!await fs.pathExists(huskyDir)) {
    logInfo('Husky directory not found. Skipping hook setup.');
    return;
  }

  // Compute the relative path from gitRoot to projectRoot so the hook
  // can cd into it regardless of where git runs the hook from.
  const relativeProjectDir = path.relative(gitRoot || projectRoot, projectRoot) || '.';

  const hookContent = buildHookScript(relativeProjectDir);

  if (await fs.pathExists(hookPath)) {
    logInfo('Pre-commit hook already configured. Overwriting with latest setup...');
  } else {
    logInfo('Creating new pre-commit hook...');
  }

  await fs.writeFile(hookPath, hookContent);
  await fs.chmod(hookPath, 0o755);

  // .gitleaksignore lives at the project root (next to package.json)
  const gitleaksIgnorePath = path.join(projectRoot, '.gitleaksignore');
  await fs.writeFile(gitleaksIgnorePath, '.tools/\nsonar-project.properties\n');
  logInfo('.gitleaksignore created — excluding .tools/ and sonar-project.properties.');

  logSuccess('Pre-commit hook created with ESLint (warn) + Gitleaks + SonarQube.');
  if (relativeProjectDir !== '.') {
    logInfo(`Monorepo detected — hook will cd into "${relativeProjectDir}" before running checks.`);
  }
};

/**
 * Build the shell script content for .husky/pre-commit.
 *
 * @param {string} relativeProjectDir  - path from git root to project root, e.g. "server" or "."
 */
function buildHookScript(relativeProjectDir) {
  const isWin = process.platform === 'win32';
  const gitleaksBin = isWin
    ? './.tools/gitleaks/gitleaks.exe'
    : './.tools/gitleaks/gitleaks';

  const isMonorepo = relativeProjectDir !== '.';

  const cdBlock = isMonorepo
    ? `
# ---------------------------------------------------------------
# Monorepo setup: cd into the project subfolder so all relative
# paths (node_modules, .tools, sonar-project.properties) resolve
# correctly.
# ---------------------------------------------------------------
HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$HOOK_DIR/${relativeProjectDir}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "[pre-commit] Project directory not found: $PROJECT_DIR — skipping checks."
  exit 0
fi

cd "$PROJECT_DIR" || exit 1
echo "[pre-commit] Working directory: $(pwd)"
`
    : '';

  const projectPrefix = isMonorepo ? `${relativeProjectDir}/` : '';

  const stripPrefixBlock = isMonorepo
    ? `
# Strip the subfolder prefix so file paths are relative to the project root
STAGED_FILES=$(echo "$ALL_STAGED" | grep "^${projectPrefix}" | sed "s|^${projectPrefix}||")
`
    : `
STAGED_FILES="$ALL_STAGED"
`;

  return `#!/bin/sh
${cdBlock}
# Collect staged files (git always returns paths relative to git root)
ALL_STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$ALL_STAGED" ]; then
  echo "No changed files detected. Skipping checks."
  exit 0
fi
echo "[Git Diff] All staged files (git root):"
echo "$ALL_STAGED" | while IFS= read -r FILE; do
  echo "  -> $FILE"
done

${stripPrefixBlock}

echo "[Git Diff] Staged files in project root (prefix=${projectPrefix}):"
echo "$STAGED_FILES" | while IFS= read -r FILE; do
  echo "  -> $FILE"
done

if [ -z "$STAGED_FILES" ]; then
  echo "No staged files in this project directory. Skipping checks."
  exit 0
fi

# ---------------------------------------------------------------
# ESLint — Auto-installs if missing, blocks commit only if lint fails
# ---------------------------------------------------------------
echo ""
echo "[ESLint] Checking staged files for JS/TS..."

# Use grep -iE for case-insensitive and extended regex
LINT_FILES=$(echo "$STAGED_FILES" | grep -iE "\\.(js|jsx|ts|tsx|mjs|cjs)$" || true)

if [ -n "$LINT_FILES" ]; then
  echo "[ESLint] Files found for linting:"
  echo "$LINT_FILES" | sed 's/^/  -> /'
else
  echo "[ESLint] No JS/TS files staged. Skipping."
fi

if [ -n "$LINT_FILES" ]; then
  if [ ! -f "./node_modules/.bin/eslint" ]; then
    echo "[ESLint] eslint not found — installing locally..."
    npm install --save-dev eslint --quiet 2>&1 | tail -n 3
  fi

  if [ -f "./node_modules/.bin/eslint" ]; then
    ESLINT_BIN="./node_modules/.bin/eslint"
    
    # Check for ESLint config files (v9+ or legacy)
    if [ -f "eslint.config.js" ] || [ -f "eslint.config.mjs" ] || [ -f "eslint.config.cjs" ] || \
       [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f ".eslintrc.yml" ] || [ -f ".eslintrc" ]; then
      echo "[ESLint] Running lint check..."
      # Use xargs carefully, ensure we pass the found files
      echo "$LINT_FILES" | xargs $ESLINT_BIN
      LINT_EXIT=$?
      if [ $LINT_EXIT -ne 0 ]; then
        echo "[ESLint] Linting failed (exit code $LINT_EXIT). Please fix errors and try again."
        exit 1
      fi
      echo "[ESLint] Lint check passed. ✔"
    else
      echo "[ESLint] No configuration file found — skipping lint check."
    fi
  else
    echo "[ESLint] Failed to install eslint — skipping (check your connection)."
  fi
fi

# ---------------------------------------------------------------
# Gitleaks — Auto-installs if missing, blocks commit if secrets found
# ---------------------------------------------------------------
echo ""
echo "[Gitleaks] Scanning staged files for secrets..."

GITLEAKS_BIN="${gitleaksBin}"

if [ ! -f "$GITLEAKS_BIN" ]; then
  echo "[Gitleaks] Binary not found — attempting automatic installation..."
  # Call our own CLI to handle the complex download/extract logic
  npx cs-setup install gitleaks
fi

if [ ! -f "$GITLEAKS_BIN" ]; then
  echo "[Gitleaks] Automatic installation failed — skipping."
else
  GITLEAKS_TMPDIR=$(mktemp -d)

  echo "$STAGED_FILES" | while IFS= read -r FILE; do
    case "$FILE" in
      sonar-project.properties) ;;
      .tools/*) ;;
      *)
        if [ -f "$FILE" ]; then
          DEST="$GITLEAKS_TMPDIR/$FILE"
          mkdir -p "$(dirname "$DEST")"
          cp "$FILE" "$DEST"
        fi
        ;;
    esac
  done

  $GITLEAKS_BIN detect --source "$GITLEAKS_TMPDIR" --no-git --verbose
  GITLEAKS_EXIT=$?
  rm -rf "$GITLEAKS_TMPDIR"

  if [ $GITLEAKS_EXIT -ne 0 ]; then
    echo "[Gitleaks] Secrets detected! Commit blocked."
    exit 1
  fi

  echo "[Gitleaks] No secrets found. ✔"
fi

# ---------------------------------------------------------------
# SonarQube — Auto-installs scanner if missing, then runs analysis
# ---------------------------------------------------------------
echo ""
echo "[SonarQube] Scanning staged files..."

if [ ! -f "./node_modules/.bin/sonar-scanner" ]; then
  echo "[SonarQube] sonar-scanner not found — installing..."
  npm install --save-dev sonarqube-scanner --quiet 2>&1 | tail -n 3
fi

if [ -f "./node_modules/.bin/sonar-scanner" ]; then
  SONAR_BIN="./node_modules/.bin/sonar-scanner"
elif command -v sonar-scanner >/dev/null 2>&1; then
  SONAR_BIN="sonar-scanner"
else
  SONAR_BIN="npx sonarqube-scanner"
fi

if [ ! -f "sonar-project.properties" ]; then
  echo "[SonarQube] sonar-project.properties not found — skipping."
else
  # Skip if token is still the placeholder
  if grep -q "REPLACE_WITH_YOUR_TOKEN" sonar-project.properties; then
    echo "[SonarQube] Token is still the default placeholder — skipping scan."
    echo "[SonarQube] Tip: Set sonar.token in sonar-project.properties to enable scanning."
  else
    SONAR_INCLUSIONS=$(echo "$STAGED_FILES" | tr '\\n' ',' | sed 's/,$//')
    echo "[SonarQube] Scanning: $SONAR_INCLUSIONS"

    $SONAR_BIN -Dsonar.inclusions="$SONAR_INCLUSIONS"
    SONAR_EXIT=$?

    if [ $SONAR_EXIT -ne 0 ]; then
      echo "[SonarQube] Analysis failed. Commit blocked."
      exit 1
    fi

    echo "[SonarQube] Analysis passed. ✔"
  fi
fi

exit 0
`;
}