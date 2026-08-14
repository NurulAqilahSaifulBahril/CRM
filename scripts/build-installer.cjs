const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const packOnly = args.has('--dir');
const outputDir = 'C:/tmp/case-hub-release';

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

fs.rmSync(outputDir, { recursive: true, force: true });

// --publish never: this only builds the installer locally. Publishing a GitHub Release (so
// electron-updater has a feed to check) is a separate step done with `gh release create`.
const builderArgs = ['--win', 'nsis', '--publish', 'never'];
if (packOnly) builderArgs.push('--dir');

run(process.execPath, [path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), ...builderArgs]);
