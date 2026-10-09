# Security policy

## Supported versions

streamlined-gantt is pre-1.0. Only the latest released minor version receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Streamlined-Analytics/streamlined-gantt/security/advisories/new).
Do not open a public issue.

Include a minimal programme JSON or HTML page that reproduces the problem, the browser and
version, and the impact you expect. We aim to acknowledge reports within five working days and
to agree a disclosure date with you once a fix is ready.

## Scope

The library renders user-supplied programme data, so the most relevant classes of issue are:

- script injection through task names, notes, tooltips, menu labels or imported files
  (all text is rendered with `textContent`; HTML requires an explicit `trustedHTML()` opt-in)
- prototype pollution through `load()`, `applyPatch()` or the MSPDI importer
- denial of service through crafted programme data (for example dependency cycles)

The library makes no network requests of its own, except fetching the `src` URL given to the
`<streamlined-gantt>` element, which is same-origin by default.
