<!-- bubbleportal:sdk-guidance:start -->
# BubblePortal project instructions

Read the installed [SDK authoring instructions](node_modules/@bubbleportal/sdk/authoring/AGENTS.md)
and follow its routing for game development, platform integration, testing and explicitly requested SDK upgrades.
Keep game-specific rules below.
If dependencies are missing, run `corepack pnpm bootstrap` first; do not fall back to copied SDK instructions.
<!-- bubbleportal:sdk-guidance:end -->

## Project instructions preserved during adoption

Keep SDK dependencies pinned to exact versions and preserve .gamego/sdk.json and
the frozen lockfile. For an explicitly requested SDK upgrade or bundled-to-npm
migration, use the [sdk-upgrade skill](.agents/skills/bubbleportal-game/SKILL.md).

## Project rules

- SDK upgrades: preview the migration with the exact target release's CLI and review the plan with
  the user before applying it. Report a manual merge instead of forcing an unsupported migration.
- Uploading a new source version, publishing and live streaming each need the user's separate go-ahead.
