// A staged event's id becomes its on-disk filename (NH-75 design §4.3) — must be filesystem-safe.
// This is the FINAL form, applied once when the request body is built at stage time.
export function slugify(input: string): string {
  return slugifyPartial(input).replace(/_+$/, '');
}

// The on-type form, for a controlled input's `onChangeText`. Identical to `slugify()` except it
// keeps a trailing separator run. Stripping the trailing `_` on every keystroke deletes the
// separator the instant it is typed, so the next character concatenates onto the previous word —
// typing "tormenta magica" yields "tormentamagica", not "tormenta_magica". That reproduces at any
// typing speed; it is not a fast-input artifact.
export function slugifyPartial(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '');
}
