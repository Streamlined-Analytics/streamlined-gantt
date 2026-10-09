# streamlined-gantt

A framework-free JavaScript Gantt and construction programme library by
[Streamlined Analytics Ltd](https://streamlinedanalytics.co.uk).

- Plain ES2022 JavaScript, **zero runtime dependencies**, no framework.
- Working-day calendars with bank holidays supplied as data, FS/SS/FF/SF links with lag, critical
  path with total, free and **negative** float.
- Construction concepts as first-class data: stage-payment milestones with values, access dates,
  baselines, lookahead, delay bands and A3 print.
- An integration API built for backends: typed events mirrored as DOM `CustomEvent`s, cancelable
  `before-*` events with `event.waitUntil(promise)` for server approval, one `change` event per
  transaction, undo/redo and `applyPatch()`.

> **Status:** pre-release (0.x), private repository. Not yet published to npm.

## Licence and attribution

streamlined-gantt is licensed under the [Apache License, Version 2.0](LICENSE).

- You may use, modify and distribute it, including in commercial and closed-source products.
- If you **redistribute** it, modified or not, keep the `LICENSE` and [`NOTICE`](NOTICE) files and
  the `/*! streamlined-gantt … */` banner at the top of each bundle (Apache-2.0 §4). Terser,
  esbuild and most other minifiers keep `/*!` comments by default; please do not strip them.
- Mark any files you have modified (§4(b)).
- The **Streamlined Analytics name and logo are not licensed** to you (Apache-2.0 §6). Do not use
  them to suggest endorsement, and do not name a fork "Streamlined Analytics …".
- The library never injects visible branding into the chart. If you would like to credit us, an
  optional, entirely voluntary badge is welcome:

  ```html
  <a href="https://github.com/Streamlined-Analytics/streamlined-gantt">
    Built with streamlined-gantt by Streamlined Analytics
  </a>
  ```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are taken under a Contributor License
Agreement ([CLA.md](CLA.md)), which is currently a draft awaiting legal review. Please read the
[code of conduct](CODE_OF_CONDUCT.md) and report vulnerabilities as described in
[SECURITY.md](SECURITY.md).

Commercial support and bespoke integration are available from
[Streamlined Analytics](https://streamlinedanalytics.co.uk).
