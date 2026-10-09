# Test flake policy

1. **Engine and Vitest browser tests never retry.** A flaky pure test is a bug in the test or the
   code. Fix it the same day.
2. **Playwright retries once, in CI only.** A test that passes on retry is reported as flaky in
   the run summary. A test that is flaky twice in seven days is quarantined with
   `test.fixme()` plus a link to a tracking issue, then fixed or deleted within seven days.
   Quarantine is never silent.
3. **Banned** (enforced by `eslint-plugin-playwright` where possible): `page.waitForTimeout`,
   global `slowMo`, `force: true` clicks, and sleeps of any kind.
4. Wait on library state, not time. Use web-first assertions
   (`await expect(locator).toHaveAttribute(...)`) or `await page.evaluate(() =>
element.gantt.whenIdle())`. `whenIdle()` resolves when no transaction, approval or render
   frame is pending.
5. Selectors use `data-task-id`, roles and accessible names. Positional CSS chains are not
   allowed.
6. Property tests print the fast-check seed and path on failure. Replay with
   `fc.assert(property, { seed, path })` before changing anything.
7. Visual baselines are generated only inside `mcr.microsoft.com/playwright:v1.63.0-noble`,
   never on a developer's host OS.
