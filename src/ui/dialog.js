// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { html } from "./dom.js";

/**
 * Native `<dialog>` helpers. A modal dialog gives focus trapping, Esc to
 * close and an inert page for free; these helpers add a labelled title, a
 * button row, and focus restoration to the element that opened it.
 *
 * @module ui/dialog
 */

let dialogCounter = 0;

/**
 * @typedef {object} DialogHandle
 * @property {HTMLDialogElement} dialog
 * @property {HTMLElement} body
 * @property {HTMLElement} actions
 * @property {(value?: string) => void} close
 * @property {Promise<string>} closed resolves with the dialog's returnValue
 */

/**
 * Opens a modal dialog inside `parent`.
 * @param {HTMLElement} parent
 * @param {{title: string, className?: string, describedBy?: string}} options
 * @returns {DialogHandle}
 */
export function openDialog(parent, options) {
  dialogCounter += 1;
  const titleId = `sg-dialog-title-${dialogCounter}`;
  const returnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  const dialog = /** @type {HTMLDialogElement} */ (
    html("dialog", {
      class: `sg-dialog ${options.className ?? ""}`.trim(),
      "aria-labelledby": titleId,
    })
  );
  const title = html("h2", { class: "sg-dialog-title", id: titleId }, [options.title]);
  const body = html("div", { class: "sg-dialog-body" });
  const actions = html("div", { class: "sg-dialog-actions" });
  dialog.append(title, body, actions);
  parent.append(dialog);
  const closed = new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        resolve(dialog.returnValue);
        dialog.remove();
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      },
      { once: true },
    );
  });
  dialog.showModal();
  return {
    dialog,
    body,
    actions,
    closed,
    close: (value = "") => {
      if (dialog.open) dialog.close(value);
    },
  };
}

/**
 * @param {string} label
 * @param {Record<string, string>} [attributes]
 * @returns {HTMLButtonElement}
 */
export function button(label, attributes = {}) {
  return /** @type {HTMLButtonElement} */ (
    html("button", { type: "button", class: "sg-button", ...attributes }, [label])
  );
}

/**
 * A confirmation dialog. Resolves true when confirmed.
 * @param {HTMLElement} parent
 * @param {{title: string, message: string, confirm: string, cancel: string, danger?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(parent, options) {
  const handle = openDialog(parent, { title: options.title, className: "sg-confirm" });
  handle.body.append(html("p", {}, [options.message]));
  const cancel = button(options.cancel);
  const confirm = button(options.confirm, {
    class: `sg-button sg-button-primary${options.danger ? " sg-button-danger" : ""}`,
  });
  cancel.addEventListener("click", () => handle.close("cancel"));
  confirm.addEventListener("click", () => handle.close("confirm"));
  handle.actions.append(cancel, confirm);
  cancel.focus();
  return handle.closed.then((value) => value === "confirm");
}
