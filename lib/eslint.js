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

  logInfo('No ESLint configuration found — creating default eslint.config.mjs...');

  if (!await fs.pathExists(TEMPLATE_PATH)) {
    logInfo('ESLint template not found — skipping auto-configuration.');
    return;
  }

  const targetPath = path.join(projectRoot, 'eslint.config.mjs');
  await fs.copy(TEMPLATE_PATH, targetPath);
  
  logSuccess('eslint.config.mjs created with base rules.');
};
