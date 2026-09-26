# @fieldops/config

Shared tooling configuration for every FieldOps workspace.

## Contents

| File | Purpose |
| --- | --- |
| `tsconfig.base.json` | Strict TypeScript baseline. Every app and package extends it. |

## Usage

```jsonc
// <workspace>/tsconfig.json
{
  "extends": "@fieldops/config/tsconfig.base.json",
  "compilerOptions": {
    // Module settings are intentionally NOT in the base config:
    // React Native (Metro/Babel) and NestJS (Node) need different ones.
  }
}
```

## Rules

- The base config only contains **strictness and safety** options. Runtime-specific options
  (`module`, `moduleResolution`, `jsx`, `lib` additions, `outDir`) belong in each workspace.
- Workspaces may add stricter options. They must not weaken the baseline (for example by
  turning off `strict` or `noUncheckedIndexedAccess`) without a documented reason.
- Shared ESLint and Prettier configuration will be added here in Version 1, when there is
  code to lint.
