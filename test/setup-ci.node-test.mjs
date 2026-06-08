import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

import {
  applyFilePlan,
  buildFilePlan,
  parseArgs,
  parseInteractiveSelection,
  TOOL_ORDER,
} from '../scripts/setup-ci.mjs';

const execFileAsync = promisify(execFile);

describe('setup-ci argument parsing', () => {
  it('parses repeated and comma-separated tools', () => {
    const options = parseArgs(['--tool', 'js-ts,python', '--tool=markdown', '--benchmark']);

    assert.deepEqual(options.tools, ['js-ts', 'python', 'markdown']);
    assert.equal(options.benchmark, true);
  });

  it('rejects unsupported tool modules', () => {
    assert.throws(() => parseArgs(['--tool', 'ruby']), /Unsupported tool module: ruby/);
  });

  it('parses interactive numbers and names', () => {
    assert.deepEqual(parseInteractiveSelection('1, python, 9'), ['js-ts', 'python', 'docker']);
  });

  it('defaults an empty interactive selection to all modules', () => {
    assert.deepEqual(parseInteractiveSelection(''), TOOL_ORDER);
  });
});

describe('setup-ci file plan', () => {
  it('builds Node, Markdown, and benchmark files without a benchmark workflow', () => {
    const plan = buildFilePlan({ tools: ['js-ts', 'markdown'], benchmark: true });
    const paths = plan.files.map((file) => file.path);

    assert(paths.includes('.github/workflows/ci.yml'));
    assert(paths.includes('package.json'));
    assert(paths.includes('eslint.config.mjs'));
    assert(paths.includes('.markdownlint-cli2.jsonc'));
    assert(paths.includes('scripts/benchmark.sh'));
    assert(!paths.includes('.github/workflows/benchmark.yml'));

    const packagePatch = plan.files.find((file) => file.path === 'package.json').patch;
    assert.equal(packagePatch.packageManager, 'pnpm@11.5.2');
    assert.equal(packagePatch.scripts.lint, 'pnpm run lint:js && pnpm run lint:markdown');
    assert.equal(packagePatch.devDependencies.vitest, '^4.1.8');
    assert.equal(packagePatch.devDependencies['markdownlint-cli2'], '^0.22.1');
  });

  it('limits benchmark commands to benchmarkable selected modules', () => {
    const plan = buildFilePlan({ tools: ['swift', 'go', 'rust'], benchmark: true });
    const benchmark = plan.files.find((file) => file.path === 'scripts/benchmark.sh').content;

    assert.match(benchmark, /Go benchmarks/);
    assert.match(benchmark, /Rust benchmarks/);
    assert.doesNotMatch(benchmark, /Swift benchmarks/);
  });

  it('generates a hadolint container command without a duplicate executable argument', () => {
    const plan = buildFilePlan({ tools: ['docker'], benchmark: false });
    const workflow = plan.files.find((file) => file.path === '.github/workflows/ci.yml').content;

    assert.match(workflow, /hadolint\/hadolint:latest "\$\{dockerfiles\[@\]\}"/);
    assert.doesNotMatch(workflow, /hadolint\/hadolint:latest hadolint/);
  });

  it('skips pytest before invoking it when the tests directory is missing', () => {
    const plan = buildFilePlan({ tools: ['python'], benchmark: false });
    const workflow = plan.files.find((file) => file.path === '.github/workflows/ci.yml').content;

    assert.match(workflow, /if \[ ! -d tests \]; then/);
    assert.match(workflow, /No tests\/ directory found; skipping pytest\./);
  });
});

describe('setup-ci file application', () => {
  it('writes files and is idempotent on a second run', async () => {
    const cwd = await tempDir();
    await fs.writeFile(path.join(cwd, '.gitignore'), '.DS_Store\n', 'utf8');

    const plan = buildFilePlan({ tools: ['python', 'bash'], benchmark: true });
    const first = await applyFilePlan({ cwd, files: plan.files });
    const second = await applyFilePlan({ cwd, files: plan.files });

    assert(first.changed.includes('.github/workflows/ci.yml'));
    assert(first.changed.includes('scripts/benchmark.sh'));
    assert(second.unchanged.includes('.github/workflows/ci.yml'));
    assert(second.unchanged.includes('.gitignore'));
    assert(second.unchanged.includes('scripts/benchmark.sh'));

    const gitignore = await fs.readFile(path.join(cwd, '.gitignore'), 'utf8');
    assert.match(gitignore, /setup-ci generated ignores/);
    assert.match(gitignore, /\.ruff_cache\//);
    assert.equal((gitignore.match(/setup-ci generated ignores/g) ?? []).length, 2);

    const benchmarkMode = (await fs.stat(path.join(cwd, 'scripts/benchmark.sh'))).mode;
    assert.equal((benchmarkMode & 0o111) !== 0, true);
  });

  it('preserves implicit CommonJS semantics in an existing package.json', async () => {
    const cwd = await tempDir();
    await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"existing-project"}\n', 'utf8');

    const plan = buildFilePlan({ tools: ['js-ts'], benchmark: false });
    await applyFilePlan({ cwd, files: plan.files });

    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    assert.equal(packageJson.name, 'existing-project');
    assert.equal(Object.hasOwn(packageJson, 'type'), false);
    assert.equal(packageJson.packageManager, 'pnpm@11.5.2');
    assert.equal(packageJson.scripts.test, 'vitest run --passWithNoTests');
  });

  it('refuses to overwrite conflicting files unless forced', async () => {
    const cwd = await tempDir();
    await fs.mkdir(path.join(cwd, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.github', 'workflows', 'ci.yml'), 'name: Custom\n', 'utf8');

    const plan = buildFilePlan({ tools: ['go'], benchmark: false });
    await assert.rejects(() => applyFilePlan({ cwd, files: plan.files }), /Refusing to overwrite/);

    const forced = await applyFilePlan({ cwd, files: plan.files, force: true });
    assert(forced.changed.includes('.github/workflows/ci.yml'));
  });

  it('dry-run reports writes without touching the filesystem', async () => {
    const cwd = await tempDir();
    const plan = buildFilePlan({ tools: ['docker'], benchmark: false });
    let output = '';
    const stdout = { write: (chunk) => { output += chunk; } };

    const result = await applyFilePlan({ cwd, files: plan.files, dryRun: true, stdout });

    assert(result.changed.includes('.hadolint.yaml'));
    assert.match(output, /\[dry-run\] write \.hadolint\.yaml/);
    await assert.rejects(() => fs.stat(path.join(cwd, '.hadolint.yaml')), /ENOENT/);
  });
});

describe('setup-ci CLI', () => {
  it('runs when the script path contains spaces', async () => {
    const cwd = await tempDir();
    const scriptDir = path.join(cwd, 'script dir with spaces');
    const workDir = path.join(cwd, 'target repo');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });
    await fs.copyFile(
      path.join(import.meta.dirname, '..', 'scripts', 'setup-ci.mjs'),
      path.join(scriptDir, 'setup-ci.mjs'),
    );

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(scriptDir, 'setup-ci.mjs'),
      '--list',
    ], {
      cwd: workDir,
    });

    assert.match(stdout, /js-ts: HTML\/JavaScript\/TypeScript/);
  });
});

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'setup-ci-test-'));
}
