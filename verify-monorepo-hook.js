const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

async function verifyMonorepoHookResilience() {
  const gitRoot = path.join('/home/creole/new_fol', 'monorepo-test-' + Date.now());
  const projectDir = path.join(gitRoot, 'apps/admin');
  const pkgDir = '/home/creole/new_fol/Latest-husky-package';
  
  try {
    console.log('--- 1. Set up monorepo ---');
    await fs.ensureDir(projectDir);
    process.chdir(gitRoot);
    execSync('git init', { stdio: 'inherit' });
    
    // Install tool in root node_modules (simulating monorepo shared tools)
    await fs.ensureDir('node_modules/.bin');
    await fs.symlink(path.join(pkgDir, 'bin/index.js'), path.join(gitRoot, 'node_modules/.bin/cs-setup'));

    console.log('\n--- 2. Init project in subfolder ---');
    process.chdir(projectDir);
    await fs.writeJSON('package.json', { name: 'admin-app' });
    execSync(`node ${path.join(pkgDir, 'bin/index.js')} init`, { stdio: 'inherit' });

    console.log('\n--- 3. Delete config and verify hook finds root binary ---');
    await fs.writeFile('index.js', 'console.log("hello");');
    await fs.remove('eslint.config.mjs');
    await fs.remove('.eslintrc.json');
    execSync('git add .', { stdio: 'inherit' });

    console.log('\nRunning the hook logic (simulated from subfolder)...');
    // The hook is at gitRoot/.husky/pre-commit
    // We run it with sh. It should cd into apps/admin and find the binary in ../../node_modules
    const hookOutput = execSync('sh ../../.husky/pre-commit', { 
        encoding: 'utf8', 
        env: { ...process.env, PATH: `${path.join(gitRoot, 'node_modules/.bin')}:${process.env.PATH}` } 
    });
    console.log(hookOutput);

    if (hookOutput.includes('✅ [ESLint] Configuration restored.')) {
       console.log('SUCCESS: Monorepo-aware hook restored configuration.');
    } else {
       console.log('FAILURE: Hook failed to restore configuration.');
    }

  } catch (err) {
    console.error('\nVerification failed:', err.message);
    if (err.stdout) console.log('STDOUT:', err.stdout);
    if (err.stderr) console.log('STDERR:', err.stderr);
  }
}

verifyMonorepoHookResilience().catch(console.error);
