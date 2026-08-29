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
