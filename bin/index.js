#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STEP 0 — Self-install own dependencies using ONLY Node.js built-ins.
//
// When installed via `npm install /local/path` or `npm install github:user/repo`,
// npm does NOT guarantee our own node_modules exists before running postinstall.
// We must bootstrap ourselves using only fs, path, child_process (always available).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..');          // our package root
const OWN_NODE_MODULES = path.join(PKG_DIR, 'node_modules');
const SENTINEL = path.join(OWN_NODE_MODULES, 'fs-extra', 'package.json');

if (!fs.existsSync(SENTINEL)) {
  console.log('[cs-setup] Installing own dependencies first...');
  const result = spawnSync('npm', ['install', '--ignore-scripts'], {
    cwd: PKG_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error('[cs-setup] Failed to install own dependencies. Please run:');
    console.error(`  cd ${PKG_DIR} && npm install`);
    process.exit(0);
  }
  console.log('[cs-setup] Own dependencies installed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Now safe to require our dependencies
// ─────────────────────────────────────────────────────────────────────────────
console.log('[cs-setup] Script starting...');

const { installHusky } = require('../lib/husky');
const { installGitleaks } = require('../lib/gitleaks');
const { installSonarScanner, setupSonarProperties } = require('../lib/sonarqube');
const { setupPreCommitHook } = require('../lib/hooks');
const { setupESLintConfig } = require('../lib/eslint');
const { setupPrePushHook, setupCIScript,
  setupCIWorkflow, validateProject,
  ensurePackageLock } = require('../lib/ci');
const { isGitRepo } = require('../lib/git');
const { logInfo, logError, logSuccess } = require('../lib/logger');
const { fixInvalidAliases } = require('../lib/fixer');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Parse command and detect context
// ─────────────────────────────────────────────────────────────────────────────
const command = process.argv[2];
const validCommands = ['init', 'install', 'check-hooks'];

if (command && !validCommands.includes(command)) {
  console.log('Usage: cs-setup [init|install|check-hooks]');
  process.exit(0);
}

const isPostInstall = process.env.npm_lifecycle_event === 'postinstall';
const initCwd = process.env.INIT_CWD || process.env.npm_config_local_prefix;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Guard: skip if npm is installing OUR OWN deps (nested postinstall)
//
// We want to run ONLY when the USER installs us.
// If process.cwd() is the SAME as initCwd, it means someone is running 
// 'npm install' inside the cs-setup folder itself (development) — skip.
// ─────────────────────────────────────────────────────────────────────────────
if (isPostInstall) {
  const currentDir = path.resolve(process.cwd());
  const projectDir = initCwd ? path.resolve(initCwd) : null;

  console.log(`[cs-setup] Post-install check: currentDir=${currentDir}, projectDir=${projectDir}`);

  // If we are developing (currentDir === projectDir), skip setup
  if (currentDir === projectDir) {
    console.log('[cs-setup] Development detected — skipping automatic setup.');
    process.exit(0);
  }

  if (!projectDir) {
    console.error('[cs-setup] Could not determine project directory. Run `npx cs-setup init` manually.');
    process.exit(0);
  }

  // cd into the user's project
  if (process.cwd() !== projectDir) {
    try {
      process.chdir(projectDir);
    } catch (e) {
      console.error(`[cs-setup] Failed to switch to project directory: ${e.message}`);
      process.exit(0);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Run the full setup
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const targetTool = process.argv[3]; // e.g. 'gitleaks'

    if (command === 'install' && targetTool === 'gitleaks') {
      await installGitleaks();
      process.exit(0);
    }

    const { found, gitRoot, projectRoot } = await isGitRepo();

    if (command === 'check-hooks') {
      if (!found) process.exit(0); // Not a git repo, nothing to check/heal
      
      const huskyDir = path.join(gitRoot, '.husky');
      const preCommit = path.join(huskyDir, 'pre-commit');
      const prePush = path.join(huskyDir, 'pre-push');

      let healed = false;
      if (!fs.existsSync(huskyDir) || !fs.existsSync(preCommit) || !fs.existsSync(prePush)) {
        logInfo('Git hooks missing or broken — re-initializing...');
        await installHusky(gitRoot);
        await setupPreCommitHook(gitRoot);
        await setupPrePushHook(gitRoot);
        healed = true;
      }

      // Also ensure ESLint and Sonar are configured
      await setupESLintConfig();
      await setupSonarProperties();

      if (healed) {
        logSuccess('Git hooks restored.');
      }
      process.exit(0);
    }

    logInfo('cs-setup: Initializing secure git hooks...');
    
    // ─────────────────────────────────────────────────────────────────────────────
    // AUTO-FIX: Handle invalid npm aliases (e.g. rolldown-vite@7.2.2)
    // ─────────────────────────────────────────────────────────────────────────────
    await fixInvalidAliases();

    if (!found) {
      logError('Not inside a git repository — skipping setup.');
      logInfo('Run `git init` first, then: npx cs-setup init');
      process.exit(0);
    }

    if (gitRoot !== projectRoot) {
      logInfo(`Git root:     ${gitRoot}`);
      logInfo(`Project root: ${projectRoot}`);
      logInfo('Monorepo detected — hooks at git root, config files at project root.');
    }

    const { installDevDependency } = require('../lib/packageManager');
    await installHusky(gitRoot);
    await installGitleaks();
    await installSonarScanner();
    await installDevDependency('eslint');
    await setupESLintConfig();
    await setupSonarProperties();
    await setupPreCommitHook(gitRoot);
    logSuccess('Husky + Gitleaks + SonarQube pre-commit hook ready.');
    logInfo('Edit sonar-project.properties — set sonar.host.url and sonar.token.');

    await ensurePackageLock();
    await require('../lib/ci').ensureProjectScripts();
    await setupCIScript(gitRoot);
    await setupCIWorkflow();
    await setupPrePushHook(gitRoot);
    logSuccess('Pre-push hook + GitHub Actions workflow ready.');

  } catch (err) {
    logError(`cs-setup failed: ${err.message}`);
    process.exit(0);
  }
})();