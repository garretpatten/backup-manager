# Contributing

Participants are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Issues

Security vulnerabilities are **not** tracked in public issues until addressed; see
**[SECURITY.md](./SECURITY.md)**.

Use [GitHub Issues](https://github.com/garretpatten/backup-manager/issues) with the
**Bug report** or **Feature request** form. Include reproduction steps, environment
details, and relevant logs from `logs/` (redact secrets and private paths).

## Pull requests

- Branch from **`master`**, focused scope per PR.
- **Sign every commit** with your GPG key; the `CI` ruleset rejects unsigned commits
  (see [signed-commits](https://github.com/garretpatten/github-standards/blob/master/signed-commits.md)).
- One approving review is required, including a **code owner** per
  [CODEOWNERS](./.github/CODEOWNERS); review threads must be resolved before merge.
- Pin third-party GitHub Actions to full commit SHAs in workflow files; bumps are
  performed manually.

### Checks (from repo root)

```bash
npm install
npm run lint
npm test
npm run typecheck
```

Or step by step:

```bash
npx prettier --check .
npx markdownlint-cli2 "**/*.md" "#node_modules"
yamllint .github .yamllint .markdownlint.yaml
actionlint
```

Install **actionlint** and **yamllint** locally if missing (`brew install actionlint`,
`pip install yamllint`). **`npm run lint`** mirrors the Prettier, Markdownlint, and
Yamllint portions of CI **Quality Checks**.

Documentation-only changes still need **`prettier`** and **`markdownlint`** on touched
Markdown files.

## AI contributions

AI-generated contributions are acceptable provided they meet every other standard:
signed commits, passing checks, no secrets, and accurate documentation.
