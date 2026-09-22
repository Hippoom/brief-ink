#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const allowedExtensions = new Set(['', '.css', '.gitignore', '.html', '.js', '.json', '.mjs', '.md', '.nvmrc', '.svg', '.ts', '.txt', '.yaml', '.yml']);
const forbiddenExtensions = new Set(['.pdf', '.ppt', '.pptx', '.woff', '.woff2', '.ttf', '.otf']);
const excludedRoots = new Set(['node_modules', '.git', 'build', 'coverage', 'dist', '.claude']);
const excludedFiles = new Set(['.claude-provider', '.DS_Store']);
const findings = [];
const scannedPaths = [];
const excludedPaths = [];

function relativePath(path) {
  return relative(root, path).split(sep).join('/');
}

function add(kind, path, message) {
  findings.push({ kind, path, message });
}

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const name = relativePath(path);
    if (entry.isSymbolicLink()) {
      add('symlink', name, 'Public payload must not contain symlinks.');
      continue;
    }
    if (entry.isDirectory()) {
      if (excludedRoots.has(entry.name)) excludedPaths.push(`${name}/`);
      else visit(path);
      continue;
    }
    if (!entry.isFile()) continue;
    if (excludedFiles.has(entry.name)) {
      excludedPaths.push(name);
      continue;
    }
    scannedPaths.push(name);
    const extension = entry.name.includes('.') ? `.${entry.name.split('.').pop().toLowerCase()}` : '';
    if (forbiddenExtensions.has(extension)) add('binary', name, `Forbidden public-payload extension ${extension}.`);
    if (!allowedExtensions.has(extension)) add('extension', name, `Extension ${extension || '(none)'} is not allowlisted.`);
    if (!allowedExtensions.has(extension) || forbiddenExtensions.has(extension)) continue;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      add('encoding', name, 'Expected UTF-8 public text could not be read.');
      continue;
    }
    if (/file:\/\//i.test(text) && name !== 'docs/public-audit-policy-v1.json') add('text', name, 'Public text must not contain file URLs.');
    if (/(^|[^a-z0-9_])~[/\\]/im.test(text)) add('text', name, 'Public text must not contain home-directory paths.');
    if (/(^|\s)\/(Users|home|private)\//m.test(text)) add('text', name, 'Public text must not contain absolute local paths.');
  }
}

visit(root);
const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
for (const required of ['.claude-provider', '/.claude/', '.claude/settings.local.json']) {
  if (!ignore.split(/\r?\n/).includes(required)) add('ignore', '.gitignore', `Missing required public-payload ignore entry: ${required}`);
}

const report = {
  schema: 'slide-public-payload-audit/v1',
  auditRoot: root,
  scannedPaths: scannedPaths.sort(),
  excludedPaths: excludedPaths.sort(),
  findings,
  result: findings.length === 0 ? 'pass' : 'fail',
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = findings.length === 0 ? 0 : 1;
