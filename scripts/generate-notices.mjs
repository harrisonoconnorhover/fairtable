// Collect installed dependency notices, without embedding local filesystem paths.
// include_dir 0.7.4 omits its MIT file from its crate archives; the exact upstream
// text is stored in scripts/licenses/include_dir-MIT.txt, from commit
// d742c6fffce99ee89da91b934e7ce6fb2a82680c (the crates' .cargo_vcs_info.json).
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, copyFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';

const execute = (command, args) => execFileSync(command, args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});
const metadata = JSON.parse(execute('cargo', ['metadata', '--format-version', '1', '--locked', '--all-features']));
const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
const included = new Set();
function visit(id) {
  if (included.has(id)) return;
  included.add(id);
  for (const dependency of nodes.get(id)?.deps ?? []) {
    if (dependency.dep_kinds.some(kind => kind.kind !== 'dev')) visit(dependency.pkg);
  }
}
for (const id of metadata.workspace_members) visit(id);

function licenseFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (!/^(licen[cs]e|copying|copyright|notice)([-_.]|$)/i.test(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isFile()) files.push(path);
    if (entry.isDirectory()) for (const child of readdirSync(path, {withFileTypes: true})) {
      if (child.isFile()) files.push(join(path, child.name));
    }
  }
  return files.sort();
}

const sections = [
  '# Fairtable third-party notices',
  'Fairtable original code is MIT licensed. The following texts are supplied with its dependencies. This inventory includes production frontend packages and the non-development Rust dependency graph, including build dependencies and target-specific packages; not every listed package is present in every binary. Rust standard-library notices are provided separately in RUST_STD_NOTICES.html.\n',
];
const rust = [...included].map(id => packages.get(id)).filter(pkg => pkg?.source)
  .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
for (const pkg of rust) {
  const directory = dirname(pkg.manifest_path);
  let files = licenseFiles(directory);
  if (pkg.license_file) files = [...new Set([...files, join(directory, pkg.license_file)])];
  if (!files.length && ['include_dir', 'include_dir_macros'].includes(pkg.name) && pkg.version === '0.7.4') {
    files = ['scripts/licenses/include_dir-MIT.txt'];
  }
  if (!files.length) throw new Error(`No license text found for Rust dependency ${pkg.name} ${pkg.version}`);
  sections.push(`## Rust: ${pkg.name} ${pkg.version}\n\nDeclared license: ${pkg.license ?? 'See license file'}\n${pkg.repository ?? ''}`);
  for (const file of files) sections.push(`### ${file.startsWith('scripts/') ? 'Upstream MIT license' : relative(directory, file)}\n\n${readFileSync(file, 'utf8')}`);
  if (pkg.name === 'libsqlite3-sys') {
    const source = readFileSync(join(directory, 'sqlite3/sqlite3.c'), 'utf8');
    const start = source.indexOf('** 2001 September 15');
    const end = source.indexOf('*************************************************************************', start);
    if (start < 0 || end < 0) throw new Error('Could not locate the bundled SQLite public-domain notice');
    sections.push(`### Bundled SQLite notice\n\n${source.slice(start, end).trim()}`);
  }
}
const frontend = Object.values(JSON.parse(execute('pnpm', ['licenses', 'list', '--prod', '--json']))).flat()
  .sort((a, b) => a.name.localeCompare(b.name));
for (const pkg of frontend) {
  sections.push(`## Frontend: ${pkg.name} ${pkg.versions.join(', ')}\n\nDeclared license: ${pkg.license}\n${pkg.homepage ?? ''}`);
  for (const directory of pkg.paths) {
    const files = licenseFiles(directory);
    if (!files.length) throw new Error(`No license text found for frontend dependency ${pkg.name}`);
    for (const file of files) sections.push(`### ${relative(directory, file)}\n\n${readFileSync(file, 'utf8')}`);
  }
}

mkdirSync('dist', {recursive: true});
const rustRoot = execute('rustc', ['--print', 'sysroot']).trim();
const rustNotice = join(rustRoot, 'share/doc/rust/COPYRIGHT-library.html');
if (!existsSync(rustNotice)) throw new Error('The pinned Rust distribution is missing COPYRIGHT-library.html; install its rust-docs component before packaging.');
copyFileSync(rustNotice, 'dist/RUST_STD_NOTICES.html');
copyFileSync('LICENSE', 'dist/LICENSE.txt');
writeFileSync('dist/THIRD_PARTY_NOTICES.txt', sections.join('\n\n') + '\n');
console.log(`Collected notices for ${rust.length} Rust and ${frontend.length} frontend packages into dist/.`);
