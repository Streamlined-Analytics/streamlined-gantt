// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Touch drags. Chromium gets trusted touch input through CDP
 * (Input.dispatchTouchEvent). WebKit has no CDP, so the iPad project
 * dispatches a synthetic PointerEvent sequence; real iPad behaviour is on the
 * manual checklist (docs/testing/manual-a11y.md).
 */
export async function touchDrag(page, browserName, from, to) {
  if (browserName === "chromium") {
    const client = await page.context().newCDPSession(page);
    const point = (x, y) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(from.x, from.y),
    });
    for (let step = 1; step <= 8; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / 8;
      const y = from.y + ((to.y - from.y) * step) / 8;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(x, y),
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return;
  }
  await page.evaluate(
    async ({ from, to }) => {
      const target = document.elementFromPoint(from.x, from.y);
      const svg = target.closest("svg");
      const base = {
        bubbles: true,
        cancelable: true,
        pointerId: 11,
        pointerType: "touch",
        isPrimary: true,
      };
      target.dispatchEvent(
        new PointerEvent("pointerdown", { ...base, clientX: from.x, clientY: from.y }),
      );
      for (let step = 1; step <= 8; step += 1) {
        svg.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            clientX: from.x + ((to.x - from.x) * step) / 8,
            clientY: from.y + ((to.y - from.y) * step) / 8,
          }),
        );
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      svg.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: to.x, clientY: to.y }));
    },
    { from, to },
  );
}
