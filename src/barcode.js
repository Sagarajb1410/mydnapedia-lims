// Code 128 (set B) barcode as an SVG string. Works with any printer and any
// standard USB/Bluetooth barcode scanner, so no printer has to be chosen yet.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

// Returns the code values (start, data, checksum, stop) for a printable ASCII string.
function encode(text) {
  const values = [START_B];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Character "${ch}" cannot be put in a barcode.`);
    values.push(c - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values;
}

// Module widths alternating bar/space, starting with a bar.
function widths(text) {
  return encode(text).map((v) => PATTERNS[v]).join('').split('').map(Number);
}

function svg(text, { moduleWidth = 2, height = 60, quiet = 10 } = {}) {
  const w = widths(text);
  const total = w.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  let rects = '';
  w.forEach((n, i) => {
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${n}" height="${height}"/>`;
    x += n;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total * moduleWidth}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Barcode ${text}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

module.exports = { PATTERNS, encode, widths, svg };
