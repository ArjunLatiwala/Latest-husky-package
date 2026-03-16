'use strict';

const fs = require('fs-extra');
const path = require('path');
const execa = require('execa');
const { logInfo, logSuccess, logError } = require('./logger');

/**
 * installDevDependency(pkg)
 *
 * Installs a package into node_modules AND records it in devDependencies
 * using a single `npm install --save-dev` call.
 *
 * This is the ONLY reliable approach on a fresh machine / CI server where
 * node_modules may not exist yet.  Writing to package.json alone (without
 * running npm install) leaves the binary missing from node_modules.
 */
exports.installDevDependency = async (pkg) => {
  const pkgPath = path.join(process.cwd(), 'package.json');

  if (!await fs.pathExists(pkgPath)) {
    logInfo(`No package.json found at ${process.cwd()}. Skipping: ${pkg}`);
    return;
  }

  // If already physically installed, skip — no reinstall needed
  const installedMarker = path.join(process.cwd(), 'node_modules', pkg, 'package.json');
  if (await fs.pathExists(installedMarker)) {
    logInfo(`${pkg} already installed in node_modules. Skipping.`);
    return;
  }

  logInfo(`Installing ${pkg}...`);
  try {
    await execa('npm', ['install', '--save-dev', pkg], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
    logSuccess(`${pkg} installed successfully.`);
  } catch (err) {
    logError(
      `Failed to install ${pkg}: ${err.message}\n` +
      `  → Run manually: npm install --save-dev ${pkg}`
    );
  }
};