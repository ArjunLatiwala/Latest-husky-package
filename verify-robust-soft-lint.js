const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

async function verifyRobustSoftLint() {
  const testDir = path.join('/home/creole/new_fol', 'robust-lint-test-' + Date.now());
  await fs.ensureDir(testDir);
  const pkgDir = '/home/creole/new_fol/Latest-husky-package';
  
  try {
    console.log('--- 1. Set up project ---');
    process.chdir(testDir);
    execSync('git init', { stdio: 'inherit' });
    await fs.writeJSON('package.json', { 
      name: 'robust-lint-project'
    });
    
    // Create a file with a deliberate lint error
    await fs.writeFile('error.js', 'const unused = 1;');

    console.log('\n--- 2. Install package ---');
    execSync(`node ${path.join(pkgDir, 'bin/index.js')} init`, { stdio: 'inherit' });

    // Simulate set -e environment by prepending it to the hook or assuming husky does it
    // Actually, we can just run the hook directly to see if it fails the shell
    const hookPath = path.join(testDir, '.husky/pre-commit');

    console.log('\n--- 3. Attempt to commit with lint error ---');
    execSync('git add .', { stdio: 'inherit' });
    
    console.log('Running git commit...');
    try {
      // We use sh -e to simulate a strict shell environment
      const output = execSync('sh -e .husky/pre-commit', { encoding: 'utf8', stdio: 'pipe' });
      console.log(output);
      if (output.includes('Continuing commit (non-blocking)')) {
        console.log('\nSUCCESS: Hook continued despite errors in set -e shell.');
      }
    } catch (err) {
      console.log('\nFAILURE: Hook terminated prematurely.');
      console.log('STDOUT:', err.stdout);
      console.log('STDERR:', err.stderr);
    }

    // Final real commit check
    try {
       execSync('git commit -m "should pass"', { stdio: 'inherit' });
       console.log('\nFinal verification: PASS (Commit succeeded)');
    } catch (err) {
       console.log('\nFinal verification: FAIL (Commit blocked)');
    }

  } catch (err) {
    console.error('\nTest failed unexpectedly:', err.message);
  } finally {
    // await fs.remove(testDir);
  }
}

verifyRobustSoftLint().catch(console.error);
