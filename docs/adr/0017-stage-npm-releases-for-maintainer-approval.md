# 0017. npm releases are staged and need a maintainer's approval

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** releasing (`.github/workflows/release.yml`)
- **Builds on:** ADR-0016 (publish to npm from a tag with trusted publishing)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

ADR-0016 publishes straight to npm when a `v*` tag is pushed. Anyone with write access to the
repository can push a tag, so anyone with write access could release a version. A stolen
GitHub session or a compromised collaborator account would be enough to ship code to every
user, with no second factor involved.

When the trusted publisher was registered on npmjs.com, it offered the choice. `npm stage
publish` is always allowed. Direct `npm publish` and `npm dist-tag` are optional and off by
default for configurations created after 3 September 2026. npm recommends stage-only.

## What did we try?

### Allow direct `npm publish` ❌ rejected

Releasing would need no further step after the tag. That leaves the gap above, and it would
need a GitHub tag ruleset to narrow it, which still has no second factor.

### Stage only ✅ chosen

The workflow runs `npm stage publish`. The tarball is uploaded and checked, but nothing is
installable until a maintainer approves the stage with 2FA, on npmjs.com or with `npm stage
approve`. `dist-tag` stays off: the workflow never moves tags.

The repository was made public at the same time, so the workflow now passes `--provenance`,
which ADR-0016 deferred. npm does not generate provenance for private repositories.

## What did we land on, and why?

Stage only, with publishing access set to "require two-factor authentication and disallow
tokens". Every release now needs both a pushed tag and a maintainer's passkey. The tag runs
the full checks, and the approval proves a person meant to release. npm `11.20.0`, already
pinned in the workflow, has `npm stage publish`.

## What does this cost us?

- One manual approval per release, and a release is not live until someone approves it.
- A stage that is never approved leaves the version unpublished. Rejecting it, or letting it
  lapse, means tagging again (with a new version if npm has reserved the number).
