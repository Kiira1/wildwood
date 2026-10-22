/**
 * Writes for code that runs every frame or HUD tick. Setting the same hidden,
 * attribute or text again still counts as a change to the page, so these only
 * write what differs.
 */
export function setText(element: Node, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

export function setHidden(element: HTMLElement, hidden: boolean) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

export function setDisabled(element: HTMLButtonElement | HTMLInputElement, disabled: boolean) {
  if (element.disabled !== disabled) element.disabled = disabled;
}

export function setAttr(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function setData(element: HTMLElement, key: string, value: string) {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

export function setClassName(element: Element, className: string) {
  if (element.className !== className) element.className = className;
}
