'use strict';

const { readJSON, writeJSON } = require('./utils');
const { installDevDependency } = require('./packageManager');
const execa = require('execa');
const path = require('path');
const { logInfo, logSuccess } = require('./logger');

/**
 * installHusky(gitRoot)
 *
 * gitRoot – directory containing .git
 *           Husky MUST be initialised here so hooks land in gitRoot/.husky/
 *           In a monorepo this differs from process.cwd() (the project root).
 */
exports.installHusky = async (gitRoot) => {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = await readJSON(pkgPath);

  // Install husky if not already in devDependencies / node_modules
  if (!pkg.devDependencies?.husky) {
    await installDevDependency('husky');
  } else {
    logInfo('Husky already in devDependencies.');
  }

  // Always run husky init from the git root so .husky/ is created there
  logInfo('Initializing Husky...');
  const opts = { stdio: 'inherit', cwd: gitRoot || process.cwd() };

  try {
    await execa('npx', ['husky'], opts);              // husky v9+
  } catch {
    try {
      await execa('npx', ['husky', 'install'], opts); // husky v8 fallback
    } catch {
      logInfo("Husky init skipped — will run on next `npm install`.");
    }
  }

  // Ensure "prepare": "husky" is set (overwrite existing if different)
  if (!pkg.scripts) pkg.scripts = {};
  if (pkg.scripts.prepare !== 'husky') {
    pkg.scripts.prepare = 'husky';
    await writeJSON(pkgPath, pkg);
    logSuccess('Ensured "prepare": "husky" script in package.json.');
  }
};