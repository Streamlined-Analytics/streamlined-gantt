# 0016. Publish to npm from a tag with trusted publishing

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** Releasing (npm package, release workflow)
- **Builds on:** none — first ADR for releasing
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

The package was marked `"private": true` and had never been published. Users had to copy files
out of the repository to use it. We wanted it on npm under the unscoped name `streamlined-gantt`
(which was free), with releases that are repeatable, checked, and do not depend on a long-lived
credential that could leak.

## What did we try?

### Manual `npm publish` from a laptop ❌ rejected

Simple, but nothing guarantees the published tarball was built from a clean checkout of a tagged
commit, or that the checks ran first. It also ties releasing to one person's machine and npm
login.

### A stored `NPM_TOKEN` secret ❌ rejected

A granular automation token in the repository secrets would let CI publish. It is a long-lived
credential: anyone who can get it out of CI can publish any version until it is rotated, and it
has to be rotated by hand.

## What did we land on, and why?

- **A tag-triggered workflow, `.github/workflows/release.yml`.** Pushing a `v*` tag runs it, and
  nothing else does. It fails unless the tag (without the `v`) equals `version` in
  `package.json`. It then builds, runs lint, type-check, engine tests and the pack smoke check,
  and publishes.
- **npm trusted publishing (OIDC).** The job has `id-token: write`, and npm exchanges GitHub's
  OIDC token for a short-lived publish credential. No npm token is stored anywhere. npmjs.com is
  configured to trust only this repository and this workflow file, so the filename is fixed.
- **A pinned npm CLI.** Trusted publishing needs npm 11.5.1 or later and Node 22.14.0 or later.
  The workflow installs an exact npm 11 release on Node 22.
- **Unscoped name and `publishConfig.access: public`,** so the first publish is public without a
  flag.

## What does this cost us?

- **No provenance while the repository is private.** npm does not generate provenance
  attestations for private repositories. `--provenance` can be added once it is public.
- **The first publish may have to be manual.** If npmjs.com cannot register a trusted publisher
  for a package that does not exist yet, the first version is published by hand and the trusted
  publisher is added afterwards.
- **A new trusted publisher configuration must see a successful publish within 2 days** of being
  created, so it should be set up just before tagging a release.
- **Renaming or moving the workflow breaks publishing** until the npmjs.com configuration is
  updated to match.
