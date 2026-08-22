// Shared plain-text rendering: word wrapping and fixed-width column tables.

/** Wrap to ~width columns, counting an optional indent prefix toward the width. */
export function wrap(text, width = 86, indent = "") {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (line && `${indent}${line} ${word}`.length > width) {
      out.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out.join("\n");
}

const pad = (rows, i) => Math.max(...rows.map((r) => String(r[i]).length));

/** Render rows as columns padded to each column's widest cell. */
export function table(rows) {
  const widths = rows[0].map((_, i) => pad(rows, i));
  return rows
    .map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd())
    .join("\n");
}
