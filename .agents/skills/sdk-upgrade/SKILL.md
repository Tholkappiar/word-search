---
name: sdk-upgrade
description: Preview or apply an explicitly requested BubblePortal SDK version upgrade or bundled-to-npm migration in this game. Do not invoke for ordinary gameplay changes.
---

Read the project's [README](../../../README.md) for bootstrap and verification commands.

Keep gameplay, rendering, local skills, authoring guidance and project configuration
owned by this repository. SDK dependencies are prebuilt external packages; do not
patch node_modules or rebuild SDK source as part of ordinary game development.

When the user requests an SDK change, inspect package.json, .gamego/sdk.json and
pnpm-lock.yaml, then run bubbleportal doctor. Choose the exact requested release,
not a floating tag. Preview with bubbleportal sdk-upgrade --to VERSION --check.
Review reported migrations and tests with the user before applying an upgrade.
Use --apply only for the requested change, then run game tests, lint, build and
the project's runtime compatibility check. Preserve generated backup information.

If source edits, a real Git submodule, credentials or unsupported/custom SDK
changes prevent a verified upgrade, stop automatic mutation and explain the
manual merge needed. Do not replace custom gameplay or local guidance with a
fresh starter. Publication and live streaming require separate authorization.
