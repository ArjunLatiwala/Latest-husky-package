'use strict';

const fs = require('fs-extra');
const path = require('path');
const execa = require('execa');
const https = require('https');
const { logInfo, logSuccess } = require('./logger');

const VERSION = '8.18.0';

function getPlatformAsset() {
  const archMap = { x64: 'x64', arm64: 'arm64', arm: 'armv7' };
  const arch = archMap[process.arch] || 'x64';

  if (process.platform === 'darwin') {
    return { filename: `gitleaks_${VERSION}_darwin_${arch}.tar.gz`, extract: 'tar', binary: 'gitleaks' };
  }
  if (process.platform === 'win32') {
    return { filename: `gitleaks_${VERSION}_windows_${arch}.zip`, extract: 'zip', binary: 'gitleaks.exe' };
  }
  return { filename: `gitleaks_${VERSION}_linux_${arch}.tar.gz`, extract: 'tar', binary: 'gitleaks' };
}

async function ensureGitignoreEntries(entries) {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  let content = await fs.pathExists(gitignorePath)
    ? await fs.readFile(gitignorePath, 'utf-8')
    : '';

  const added = [];
  for (const entry of entries) {
    if (!content.split('\n').some(l => l.trim() === entry.trim())) {
      content += `\n${entry}`;
      added.push(entry);
    }
  }
  if (added.length) {
    await fs.writeFile(gitignorePath, content);
    logInfo(`.gitignore updated — added: ${added.join(', ')}`);
  }
}

async function extractTar(archive, destDir) {
  await execa('tar', ['-xzf', archive, '-C', destDir]);
}

async function extractZip(archive, destDir) {
  if (process.platform === 'win32') {
    await execa('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Force -Path "${archive}" -DestinationPath "${destDir}"`,
    ]);
    return;
  }
  try {
    await execa('unzip', ['-o', archive, '-d', destDir]);
  } catch {
    try {
      await execa('python3', ['-c',
        `import zipfile; zipfile.ZipFile('${archive}').extractall('${destDir}')`]);
    } catch {
      throw new Error('Cannot extract zip — install `unzip` (apt/brew) or Python 3.');
    }
  }
}

exports.installGitleaks = async () => {
  const { filename, extract, binary } = getPlatformAsset();
  const gitleaksDir = path.join(process.cwd(), '.tools', 'gitleaks');
  const binaryPath = path.join(gitleaksDir, binary);

  if (await fs.pathExists(binaryPath)) {
    logInfo('Gitleaks already installed.');
    return;
  }

  logInfo('Installing Gitleaks locally...');
  await fs.ensureDir(gitleaksDir);

  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${filename}`;
  const destPath = path.join(gitleaksDir, filename);

  logInfo(`Downloading ${filename}...`);
  await downloadFile(url, destPath);

  logInfo(`Extracting...`);
  if (extract === 'tar') await extractTar(destPath, gitleaksDir);
  else await extractZip(destPath, gitleaksDir);

  await fs.remove(destPath);
  if (process.platform !== 'win32') await fs.chmod(binaryPath, 0o755);

  await ensureGitignoreEntries(['.tools/', 'node_modules/', '.env', '.env.*', '.env.local']);
  logSuccess('Gitleaks installed.');
};

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node-cs-setup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.remove(dest).catch(() => { }); reject(err); });
    }).on('error', reject);
  });
}