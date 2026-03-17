const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

async function testPostInstall() {
  const testDir = path.join('/home/creole/new_fol', 'postinstall-test-' + Date.now());
  await fs.ensureDir(testDir);
  const pkgDir = '/home/creole/new_fol/Latest-husky-package';

  try {
    console.log('--- 1. Set up test project ---');
    process.chdir(testDir);
    execSync('git init', { stdio: 'inherit' });
    await fs.writeJSON('package.json', { name: 'test-project' });

    console.log('\n--- 2. Install package locally ---');
    // Using --foreground-scripts to see the output
    execSync(`npm install ${pkgDir} --foreground-scripts`, { stdio: 'inherit' });

    console.log('\n--- 3. Verify results ---');
    const huskyExists = await fs.pathExists('.husky/pre-commit');
    const scriptsExists = await fs.pathExists('scripts');
    console.log('Husky installed:', huskyExists ? 'PASS' : 'FAIL');
    console.log('Scripts installed:', scriptsExists ? 'PASS' : 'FAIL');

    if (!huskyExists || !scriptsExists) {
      console.log('Installation failed. Checking node_modules/cs-setup...');
      const installedPkg = await fs.readJSON('node_modules/cs-setup/package.json');
      console.log('Installed version:', installedPkg.version);
    }

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    // await fs.remove(testDir);
    console.log('Test dir:', testDir);
  }
}

testPostInstall().catch(console.error);
