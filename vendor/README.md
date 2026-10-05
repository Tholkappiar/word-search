# Bundled GameInstance SDK

This game contains a versioned source distribution in vendor/gameinstance.
A normal clone includes everything needed; no Git submodule, private SDK
repository access, or package registry credentials are needed. Public dependency
downloads still require network access on a cold installation.

SDK.json records the distribution version, exact source identity and file hashes.
.streamforge-submodules.json retains its historical filename for runtime
compatibility; schema version 3 declares a bundled distribution, not a submodule.
The identity covers SDK source, package manifests, TypeScript configuration and
the shared tsconfig.base.json. SDK tests, build output and platform services are
excluded. Bootstrap and doctor verify this identity before using SDK code.

Treat this directory as one versioned dependency. Upgrade it as a complete bundle,
regenerate the game's frozen lockfile when dependencies change, and rerun game
tests and runtime checks. Do not patch vendor source for ordinary game changes.
Content identity identifies the exact SDK revision even when package versions
have not changed. Compatible runtime images check the game contract version and
the game's own bundle identity; they do not substitute their SDK into this game.
