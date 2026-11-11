/** Read the same resolved design tokens used by the Tailwind stylesheet. */
export function cssToken(name, element = globalThis.document?.documentElement) {
  if (!/^--[a-z][a-z0-9-]*$/i.test(name) || !element) throw new TypeError(`Design token unavailable: ${name}`);
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (!value) throw new TypeError(`Design token is undefined: ${name}`);
  return value;
}

export function numberToken(name, element) {
  const value = cssToken(name, element);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Numeric design token required: ${name}`);
  return number;
}

export function pixelToken(name, element = globalThis.document?.documentElement) {
  const value = cssToken(name, element);
  const match = value.match(/^(-?\d*\.?\d+)(px|rem|em)?$/);
  if (!match) throw new TypeError(`Length design token required: ${name}`);
  const root = element.ownerDocument.documentElement;
  const scale = match[2] === 'rem' ? parseFloat(getComputedStyle(root).fontSize)
    : match[2] === 'em' ? parseFloat(getComputedStyle(element).fontSize) : 1;
  return Number(match[1]) * scale;
}
