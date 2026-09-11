# Contributing

## Conventional titles and commits

Pull request titles and commit subjects use the Conventional Commits shape:

```text
<type>(optional-scope): description
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`.

Examples:

```text
feat(web): add mechanism index page
fix(renderer-svg): increase responsive stroke weight
chore(ci): enforce conventional metadata
```

Breaking changes may use `!` before the colon, for example `feat(model)!: revise constraint schema`.

The pull request check validates both the PR title and every commit subject on the PR branch. Keeping the PR title conventional also gives squash merges a conventional final subject.

## JSON catalog authoring

See [Editor schema and validation parity](docs/architecture/json-catalog-schema.md)
for the local editor association, supported document versions and runtime-only
validation requirements. Run `npm run catalog:schema:check` for the focused tests;
`npm run check` includes them in the complete repository checks.

When changing the authoring vocabulary, update the JSON Schema and parser tests
together. Passing editor validation is not a substitute for compilation, actual
simulation, safe content publication or the milestone's interactive-page proof.
