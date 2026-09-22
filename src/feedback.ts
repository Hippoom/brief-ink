import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';

export const FEEDBACK_SCOPES = ['unknown', 'content', 'project', 'theme', 'skill', 'fixture', 'bug'] as const;
export type FeedbackScope = (typeof FEEDBACK_SCOPES)[number];

export const FEEDBACK_STATUSES = ['observed', 'candidate', 'accepted', 'rejected', 'verified'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackSource = 'user' | 'self' | 'review';

export interface FeedbackRecord {
  id: string;
  created_at: string;
  updated_at: string;
  status: FeedbackStatus;
  message: string;
  source: { type: FeedbackSource };
  context: {
    project: string;
    deck?: string;
    render_config?: string;
    slide_id?: string;
  };
  classification: { scope: FeedbackScope; rationale?: string };
  evidence: {
    implementation?: string;
    verification?: string;
    fixtures: string[];
  };
}

const SENSITIVE_VALUE = /(?:api[_-]?key|access[_-]?token|token|secret|password|key)\s*[:=]\s*\S+|authorization\s*:\s*bearer\s+\S+|\bsk-[a-zA-Z0-9_-]{12,}\b/i;

function feedbackRoot(projectRoot: string): string {
  return resolve(projectRoot, '.slide', 'feedback');
}

function directoryFor(status: FeedbackStatus): string {
  if (status === 'observed') return 'inbox';
  if (status === 'candidate') return 'triaged';
  return status;
}

function ensureInsideProject(projectRoot: string, candidate: string, label: string): string {
  const absolute = resolve(candidate);
  const pathFromRoot = relative(projectRoot, absolute);
  if (pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !pathFromRoot.startsWith('..'))) {
    return pathFromRoot || '.';
  }
  throw new Error(`${label} must be inside the project directory: ${projectRoot}`);
}

function assertNoCredential(value: string, label: string): void {
  if (SENSITIVE_VALUE.test(value)) {
    throw new Error(`${label} appears to contain a credential. Do not store API keys, tokens, passwords, or secrets in feedback records.`);
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function dateSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'feedback';
}

function allRecordPaths(projectRoot: string): string[] {
  const root = feedbackRoot(projectRoot);
  if (!existsSync(root)) return [];
  const directories = ['inbox', 'triaged', 'accepted', 'rejected', 'verified'];
  return directories.flatMap((directory) => {
    const path = resolve(root, directory);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((name) => name.endsWith('.yaml'))
      .map((name) => resolve(path, name));
  });
}

function readRecord(path: string): FeedbackRecord {
  const value = parseYaml(readFileSync(path, 'utf8')) as FeedbackRecord;
  if (!value?.id || !value?.status || !value?.message) throw new Error(`Invalid feedback record: ${path}`);
  return value;
}

function writeRecord(path: string, record: FeedbackRecord): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, stringifyYaml(record, { lineWidth: 0 }), 'utf8');
}

function findRecord(projectRoot: string, id: string): { path: string; record: FeedbackRecord } {
  const matches = allRecordPaths(projectRoot).filter((path) => path.endsWith(`${sep}${id}.yaml`));
  if (matches.length === 0) throw new Error(`Feedback record not found: ${id}`);
  if (matches.length > 1) throw new Error(`Multiple feedback records use id: ${id}`);
  return { path: matches[0], record: readRecord(matches[0]) };
}

function nextId(projectRoot: string, message: string): string {
  const day = timestamp().slice(0, 10);
  const base = `${day}-${dateSlug(message)}`;
  const ids = new Set(allRecordPaths(projectRoot).map((path) => path.split(sep).at(-1)?.replace(/\.yaml$/, '')));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function assertFeedbackProject(projectRootInput: string, skillRoot: string): string {
  const projectRoot = resolve(projectRootInput);
  const normalizedSkillRoot = resolve(skillRoot);
  if (projectRoot === normalizedSkillRoot || projectRoot.startsWith(`${normalizedSkillRoot}${sep}`)) {
    throw new Error('Feedback must be stored in a deck project, never below the Slide Skill source directory. Use --project <deck-project>.');
  }
  return projectRoot;
}

export function addFeedback(input: {
  projectRoot: string;
  message: string;
  deck?: string;
  renderConfig?: string;
  slideId?: string;
  source?: FeedbackSource;
}): FeedbackRecord {
  if (!input.message.trim()) throw new Error('Feedback message must not be empty.');
  assertNoCredential(input.message, 'Feedback');
  const record: FeedbackRecord = {
    id: nextId(input.projectRoot, input.message),
    created_at: timestamp(),
    updated_at: timestamp(),
    status: 'observed',
    message: input.message.trim(),
    source: { type: input.source ?? 'self' },
    context: {
      project: '.',
      ...(input.deck ? { deck: ensureInsideProject(input.projectRoot, input.deck, 'Deck path') } : {}),
      ...(input.renderConfig ? { render_config: ensureInsideProject(input.projectRoot, input.renderConfig, 'Render config path') } : {}),
      ...(input.slideId ? { slide_id: input.slideId } : {}),
    },
    classification: { scope: 'unknown' },
    evidence: { fixtures: [] },
  };
  const path = resolve(feedbackRoot(input.projectRoot), directoryFor(record.status), `${record.id}.yaml`);
  writeRecord(path, record);
  return record;
}

export function listFeedback(projectRoot: string, status?: FeedbackStatus): FeedbackRecord[] {
  return allRecordPaths(projectRoot)
    .map(readRecord)
    .filter((record) => !status || record.status === status)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function triageFeedback(input: {
  projectRoot: string;
  id: string;
  scope: FeedbackScope;
  status: 'candidate' | 'accepted' | 'rejected';
  rationale?: string;
}): FeedbackRecord {
  const found = findRecord(input.projectRoot, input.id);
  if (input.rationale) assertNoCredential(input.rationale, 'Feedback rationale');
  if (found.record.status === 'verified') throw new Error('Verified feedback is immutable. Create a new feedback record for a new observation.');
  found.record.status = input.status;
  found.record.updated_at = timestamp();
  found.record.classification = { scope: input.scope, ...(input.rationale ? { rationale: input.rationale } : {}) };
  const target = resolve(feedbackRoot(input.projectRoot), directoryFor(found.record.status), `${found.record.id}.yaml`);
  mkdirSync(resolve(target, '..'), { recursive: true });
  if (target !== found.path) renameSync(found.path, target);
  writeRecord(target, found.record);
  return found.record;
}

export function verifyFeedback(input: {
  projectRoot: string;
  id: string;
  implementation: string;
  verification: string;
  fixtures: string[];
}): FeedbackRecord {
  const found = findRecord(input.projectRoot, input.id);
  if (found.record.status !== 'accepted') throw new Error('Only accepted feedback can be verified. Run feedback triage ... --status accepted first.');
  if (!input.implementation.trim() || !input.verification.trim()) {
    throw new Error('Verification requires both --implementation and --verification evidence.');
  }
  assertNoCredential(input.implementation, 'Implementation evidence');
  assertNoCredential(input.verification, 'Verification evidence');
  found.record.status = 'verified';
  found.record.updated_at = timestamp();
  found.record.evidence = {
    implementation: input.implementation.trim(),
    verification: input.verification.trim(),
    fixtures: input.fixtures.map((fixture) => ensureInsideProject(input.projectRoot, fixture, 'Fixture path')),
  };
  const target = resolve(feedbackRoot(input.projectRoot), directoryFor(found.record.status), `${found.record.id}.yaml`);
  mkdirSync(resolve(target, '..'), { recursive: true });
  if (target !== found.path) renameSync(found.path, target);
  writeRecord(target, found.record);
  return found.record;
}
