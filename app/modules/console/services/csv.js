// CSV cells for the history export. Every cell is quoted, and a cell a spreadsheet would
// run as a formula is made plain text.

// A cell starting with one of these is treated as a formula by Excel and Sheets.
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * @param {unknown} value
 * @returns {string} one quoted, injection-safe cell
 */
export function csvCell(value) {
  let text;
  if (value === null || value === undefined) text = "";
  else if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * @param {unknown[]} values
 * @returns {string} one line, ending in CRLF
 */
export function csvRow(values) {
  return `${values.map(csvCell).join(",")}\r\n`;
}
