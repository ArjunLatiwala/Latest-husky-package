'use strict';

const fs = require('fs-extra');
const path = require('path');
const { logInfo, logSuccess } = require('./logger');

const TEMPLATE_PATH = path.resolve(__dirname, '../templates/eslint.config.mjs');

/**
 * setupESLintConfig()
 * Checks if an ESLint configuration exists. If not, creates a default one.
 */
exports.setupESLintConfig = async () => {
  const projectRoot = process.cwd();
  
  // List of common ESLint config files (legacy and flat)
  const configFiles = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc.json',
    '.eslintrc'
  ];

  let hasConfig = false;
  for (const file of configFiles) {
    if (await fs.pathExists(path.join(projectRoot, file))) {
      hasConfig = true;
      break;
    }
  }

  // Also check package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!hasConfig && await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJSON(pkgPath);
    if (pkg.eslintConfig) {
      hasConfig = true;
    }
  }

  if (hasConfig) {
    logInfo('ESLint configuration already exists — skipping auto-configuration.');
    return;
  }

  // 0. Attempt Interactive Initialization (if in TTY and NOT postinstall)
  const isPostInstall = process.env.npm_lifecycle_event === 'postinstall';
  const isTTY = process.stdout.isTTY;

  if (isTTY && !isPostInstall) {
    logInfo('Interactive environment detected — launching ESLint initializer...');
    try {
      const { execSync } = require('child_process');
      // npx eslint --init is the official interactive wizard
      execSync('npx eslint --init', { stdio: 'inherit' });
      
      // Re-check if a config was created
      for (const file of configFiles) {
        if (await fs.pathExists(path.join(projectRoot, file))) {
          logSuccess('ESLint initialized interactively. ✔');
          return;
        }
      }
    } catch (e) {
      logInfo('Interactive initialization skipped or failed — falling back to automatic setup.');
    }
  }

  // 1. Detect ESLint version
  let isLegacy = false;
  try {
    const eslintPkgPath = path.join(projectRoot, 'node_modules', 'eslint', 'package.json');
    if (await fs.pathExists(eslintPkgPath)) {
      const eslintPkg = await fs.readJSON(eslintPkgPath);
      const version = parseInt(eslintPkg.version.split('.')[0], 10);
      if (version < 9) {
        isLegacy = true;
      }
    } else {
      // Fallback: If not in node_modules, check if globally available or assume modern
      // For safety, if we can't find it, we'll try to guess from peerDeps or just assume flat.
    }
  } catch (e) {
    // Ignore errors, assume modern
  }

  const templateFile = isLegacy ? '.eslintrc.json' : 'eslint.config.mjs';
  const fullTemplatePath = path.resolve(__dirname, '../templates', templateFile);
  const targetPath = path.join(projectRoot, templateFile);

  logInfo(`No ESLint configuration found — creating default ${templateFile} (Legacy: ${isLegacy})...`);

  if (!await fs.pathExists(fullTemplatePath)) {
    logInfo(`${templateFile} template not found — skipping auto-configuration.`);
    return;
  }

  await fs.copy(fullTemplatePath, targetPath);
  logSuccess(`Created ${targetPath}`);

  // Cleanup: Remove redundant eslintConfig from package.json
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJSON(pkgPath);
    if (pkg.eslintConfig) {
      delete pkg.eslintConfig;
      await fs.writeJSON(pkgPath, pkg, { spaces: 2 });
      logInfo('Removed redundant eslintConfig from package.json.');
    }
  }
};
