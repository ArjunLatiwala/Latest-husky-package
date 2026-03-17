const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

async function verifyOptimizations() {
  const testDir = path.join('/home/creole/new_fol', 'opt-test-' + Date.now());
  await fs.ensureDir(testDir);
  const pkgDir = '/home/creole/new_fol/Latest-husky-package';
  
  try {
    console.log('--- 1. Set up test project ---');
    process.chdir(testDir);
    execSync('git init', { stdio: 'inherit' });
    await fs.writeJSON('package.json', { 
      name: 'opt-test-project',
      scripts: { test: 'node --test' }
    });

    console.log('\n--- 2. First install ---');
    execSync(`node ${path.join(pkgDir, 'bin/index.js')} init`, { stdio: 'inherit' });

    console.log('\n--- 3. Verify second install skips dependency ---');
    const output = execSync(`node ${path.join(pkgDir, 'bin/index.js')} check-hooks`, { encoding: 'utf8' });
    console.log(output);
    if (output.includes('sonarqube-scanner is already installed — skipping')) {
      console.log('Dependency optimization: PASS');
    } else {
      console.log('Dependency optimization: FAIL');
    }

    console.log('\n--- 4. Customize sonar-project.properties ---');
    let props = await fs.readFile('sonar-project.properties', 'utf8');
    props = props.replace('sonar.login=sqa_e42cc149df0b02a3b90e7de5525001608c4d23a4', 'sonar.login=CUSTOM_TOKEN');
    await fs.writeFile('sonar-project.properties', props);
    console.log('Properties customized.');

    console.log('\n--- 5. Verify sonar-project.properties is NOT overwritten ---');
    const output2 = execSync(`node ${path.join(pkgDir, 'bin/index.js')} check-hooks`, { encoding: 'utf8' });
    console.log(output2);
    if (output2.includes('sonar-project.properties already customized — skipping')) {
      console.log('Properties optimization: PASS');
    } else {
      console.log('Properties optimization: FAIL');
    }

    const finalProps = await fs.readFile('sonar-project.properties', 'utf8');
    if (finalProps.includes('sonar.login=CUSTOM_TOKEN')) {
      console.log('Content preservation: PASS');
    } else {
      console.log('Content preservation: FAIL');
    }

  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    await fs.remove(testDir);
  }
}

verifyOptimizations().catch(console.error);
