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

  logInfo('No ESLint configuration found — injecting default eslintConfig into package.json...');

  if (!await fs.pathExists(pkgPath)) {
    logInfo('package.json not found — skipping auto-configuration.');
    return;
  }

  const pkg = await fs.readJSON(pkgPath);
  
  // Detect React/Typescript for smarter defaults
  const isReact = pkg.dependencies?.react || pkg.devDependencies?.react;
  const isTS = pkg.dependencies?.typescript || pkg.devDependencies?.typescript;

  pkg.eslintConfig = {
    env: {
      browser: true,
      node: true,
      es2021: true
    },
    extends: [
      "eslint:recommended"
    ],
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: {
        jsx: isReact ? true : false
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error"
    }
  };

  if (isReact) {
    // Add basic React rules if they are likely to be present
    // Note: We don't want to force-install plugins here as it might be too heavy
    // but we can at least set the env/parserOptions.
    pkg.eslintConfig.rules["react/jsx-uses-react"] = "off";
    pkg.eslintConfig.rules["react/react-in-jsx-scope"] = "off";
  }

  await fs.writeJSON(pkgPath, pkg, { spaces: 2 });
  logSuccess(`Updated package.json with default eslintConfig.`);
};
