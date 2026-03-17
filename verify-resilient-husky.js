const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

async function verifyResilientHusky() {
  const testDir = path.join('/home/creole/new_fol', 'resilient-husky-' + Date.now());
  await fs.ensureDir(testDir);
  const pkgDir = '/home/creole/new_fol/Latest-husky-package';
  
  try {
    console.log('--- 1. Set up project ---');
    process.chdir(testDir);
    await fs.writeJSON('package.json', { name: 'resilient-project' });

    console.log('\n--- 2. Run cs-setup init ---');
    execSync(`node ${path.join(pkgDir, 'bin/index.js')} init`, { stdio: 'inherit' });

    console.log('\n--- 3. Verify package.json contains "husky || true" ---');
    const pkg = await fs.readJSON('package.json');
    if (pkg.scripts && pkg.scripts.prepare === 'husky || true') {
      console.log('SUCCESS: "prepare": "husky || true" found in consumer package.json.');
    } else {
      console.log('FAILURE: Resilient prepare script missing. Found:', pkg.scripts ? pkg.scripts.prepare : 'none');
    }

    console.log('\n--- 4. Verify tool\'s package.json ---');
    const toolPkg = await fs.readJSON(path.join(pkgDir, 'package.json'));
    if (toolPkg.scripts && toolPkg.scripts.prepare === 'husky || true') {
      console.log('SUCCESS: "prepare": "husky || true" found in tool package.json.');
    } else {
      console.log('FAILURE: Tool\'s prepare script not updated.');
    }

  } catch (err) {
    console.error('\nVerification failed:', err.message);
  }
}

verifyResilientHusky().catch(console.error);
