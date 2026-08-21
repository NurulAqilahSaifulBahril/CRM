// Builds the Windows installer AND publishes it as a GitHub Release, which is what gives
// electron-updater a feed to check. `npm run dist:win` only builds locally; without a published
// release, installed copies have nothing to update from.
//
// electron-builder does the publishing itself rather than us calling `gh release create`, because
// the release must carry `latest.yml` alongside the .exe. That file is the update feed — an .exe
// uploaded on its own leaves auto-update silently broken.
//
// Requires a GitHub token in the environment (GH_TOKEN or GITHUB_TOKEN) with `repo` scope. Never
// commit it; set it per-shell:
//     $env:GH_TOKEN = "ghp_..."      # PowerShell
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const outputDir = 'C:/tmp/case-hub-release';

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;

function fail(message, hint) {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  process.exit(1);
}
function git(...a) {
  return spawnSync('git', a, { cwd: rootDir, encoding: 'utf8', shell: false }).stdout?.trim() ?? '';
}

console.log(`\n  Publishing Eternalgy CRM v${version}\n`);

/* ---- preflight ---- */

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token && !dryRun) {
  fail('No GitHub token found.',
       'Set one for this shell:  $env:GH_TOKEN = "ghp_..."   (needs `repo` scope, never commit it)');
}

// The installer bundles .env.local — without it the shipped app has no database configuration and
// every screen comes up empty.
if (!fs.existsSync(path.join(rootDir, '.env.local'))) {
  fail('.env.local is missing.',
       'The desktop app bundles it for the Postgres connection. Restore it before publishing.');
}

// Publishing code that is not committed makes a release nobody can reproduce.
const dirty = git('status', '--porcelain');
if (dirty) {
  console.warn('  ! Working tree has uncommitted changes:');
  dirty.split('\n').slice(0, 10).forEach(l => console.warn(`      ${l}`));
  if (!args.has('--allow-dirty')) {
    fail('Refusing to publish an uncommitted tree.', 'Commit first, or pass --allow-dirty if you are sure.');
  }
}

// electron-updater compares against the version in the release. Re-publishing the same version
// means installed copies never see an update.
const existingTag = git('tag', '--list', `v${version}`);
if (existingTag) {
  fail(`Tag v${version} already exists — this version was published before.`,
       'Bump "version" in package.json before publishing again.');
}

/* ---- build + publish ---- */

fs.rmSync(outputDir, { recursive: true, force: true });

const builderArgs = ['--win', 'nsis', '--publish', dryRun ? 'never' : 'always'];
const result = spawnSync(
  process.execPath,
  [path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), ...builderArgs],
  { cwd: rootDir, stdio: 'inherit', shell: false, windowsHide: true, env: process.env }
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

/* ---- report ---- */

const produced = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];
const hasFeed = produced.includes('latest.yml');
console.log(`\n  Built in ${outputDir}:`);
produced.filter(f => /\.(exe|yml)$/i.test(f)).forEach(f => console.log(`    ${f}`));

if (dryRun) {
  console.log('\n  Dry run — nothing was published.\n');
} else if (!hasFeed) {
  console.warn('\n  ! latest.yml was not produced — installed copies will not see this update.\n');
} else {
  console.log(`\n  Published to https://github.com/${pkg.build.publish.owner}/${pkg.build.publish.repo}/releases`);
  console.log('  The release is created as a DRAFT. Installed copies only see it once you publish');
  console.log('  the draft on GitHub.\n');
}
