# Codex-Gated Repository Template

This template starts a repository with the Codex review gate v2 workflows on
the default branch. It also includes a modular CI generator for adding
project-specific formatter, linter, test, and benchmark entrypoints after a
repository is created from the template.

## Included

- `.github/workflows/codex-review-gate.yml` (read-only pull-request verifier)
- `.github/workflows/codex-review-gate-controller.yml` (review-event and manual controller)
- `.github/CODEOWNERS` (control-plane ownership)
- `rulesets/codex-review-gate.json` (Disabled v2 ruleset import template)
- `.gitignore`
- `scripts/setup-ci.mjs`
- this README

The verifier uses `JoeyTeng/codex-review-gate-action@v2` and produces the native
`codex/github-review-gate` check for each ready pull request head. The separate
controller handles official Codex comments and exact-head manual reconciliation;
it has no scheduled job. The floating major-version reference is intentional:
compatible v2 releases can reach consumers without changing each repository.
The included ruleset file is only an import template; copying it does not
activate repository protection.

## Generate Project CI

Run the setup script from a new repository created from this template:

```bash
node scripts/setup-ci.mjs
```

With no arguments, the script opens an interactive selector. For repeatable setup,
pass modules explicitly:

```bash
node scripts/setup-ci.mjs --tool js-ts --tool python --tool docker --tool markdown
node scripts/setup-ci.mjs --all --benchmark --dry-run
```

The script writes `.github/workflows/ci.yml` plus the selected tool configs. It is
idempotent when generated files have not changed. If a target file already exists
with different content, the script refuses to overwrite it unless `--force` is
provided. Use `--dry-run` to inspect planned writes first.

Supported modules:

- `js-ts`: pnpm, ESLint, Prettier, Vite, and Vitest.
- `python`: uv, Ruff, Pyright, and pytest.
- `swift`: swift-format, SwiftLint, and `swift test`.
- `go`: `gofmt`, `go vet`, and `go test`.
- `rust`: `cargo fmt`, `cargo clippy`, and `cargo test`.
- `github-actions`: actionlint.
- `bash`: shfmt, shellcheck, and `bash -n`.
- `markdown`: Prettier and markdownlint-cli2.
- `docker`: hadolint and `docker buildx build --check`.

`--benchmark` creates `scripts/benchmark.sh` only. It does not create or enable a
benchmark workflow, and benchmark commands are not part of the default PR gate.
The script includes benchmark entries for JavaScript/TypeScript, Python, Go, and
Rust when those modules are selected.

## After Creating a Repository

1. Add the project source, tests, and license.
2. Run `node scripts/setup-ci.mjs` and commit the generated CI/tooling files.
3. Install or lock generated dependencies where applicable, such as `pnpm install`
   for JavaScript/TypeScript or Markdown modules.
4. Confirm both gate workflows and `.github/CODEOWNERS` are on the default
   branch. Set the control-plane owner in CODEOWNERS to an eligible maintainer.
5. Follow the [canonical v2 installation guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.md):
   import or stage `rulesets/codex-review-gate.json` as Disabled, verify
   `codex/github-review-gate` with a
   separate harmless canary PR, then activate and read back the ruleset. Do not
   require the v2 check while its workflow exists only on a feature branch.
   If migrating an existing v1 repository, keep the old requirement active
   until the v2 ruleset is verified Active, then remove only the legacy gate.

## Optional Repository Variables

- `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true`: use `ubuntu-latest` when the
  default `ubuntu-slim` runner is unsuitable.
- `CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`: raise the bounded scan profile
  for repositories with exceptionally large pull requests (default: `default`).

## Template Maintenance

Run the generator tests with Node's built-in test runner:

```bash
node --test test/setup-ci.node-test.mjs
```
