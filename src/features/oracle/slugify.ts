// A staged event's id becomes its on-disk filename (NH-75 design §4.3) — must be filesystem-safe.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
