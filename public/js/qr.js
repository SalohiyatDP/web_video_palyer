/**
 * Minimal, dependency-free QR Code generator (ISO/IEC 18004).
 *
 * Scope: byte mode (UTF-8), error correction level M, versions 1..20
 * (up to 666 bytes of payload) - more than enough for URLs.
 *
 * Public API:
 *   encode(text)                  -> { version, mask, size, modules }
 *   drawOnCanvas(canvas, text, o) -> { version, mask, size, pixelSize }
 */

/* ------------------------------------------------------------------ *
 * Galois field GF(256) arithmetic, primitive polynomial 0x11D
 * ------------------------------------------------------------------ */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generator polynomial for `degree` error correction codewords. */
function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon error correction codewords for one block. */
export function rsEncode(data, ecLength) {
  const gen = rsGeneratorPoly(ecLength);
  const buffer = new Uint8Array(data.length + ecLength);
  buffer.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const factor = buffer[i];
    if (factor === 0) continue;
    for (let j = 1; j < gen.length; j++) {
      buffer[i + j] ^= gfMul(gen[j], factor);
    }
  }
  return buffer.subarray(data.length);
}

/* ------------------------------------------------------------------ *
 * Version tables (error correction level M only)
 *   version: [ecCodewordsPerBlock, [[blockCount, dataCodewords], ...]]
 * ------------------------------------------------------------------ */
const EC_BLOCKS_M = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
  11: [30, [[1, 50], [4, 51]]],
  12: [22, [[6, 36], [2, 37]]],
  13: [22, [[8, 37], [1, 38]]],
  14: [24, [[4, 40], [5, 41]]],
  15: [24, [[5, 41], [5, 42]]],
  16: [28, [[7, 45], [3, 46]]],
  17: [28, [[10, 46], [1, 47]]],
  18: [26, [[9, 43], [4, 44]]],
  19: [26, [[3, 44], [11, 45]]],
  20: [26, [[3, 41], [13, 42]]],
};

const MIN_VERSION = 1;
const MAX_VERSION = 20;

/** Alignment pattern centre coordinates per version. */
const ALIGNMENT_CENTERS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
};

const MODE_BYTE = 0b0100;
/** Error correction level M is encoded as `00` in the format information. */
const EC_LEVEL_BITS_M = 0b00;

const G15 = 0b101_0011_0111; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
const G15_MASK = 0b101_0100_0001_0010;
const G18 = 0b1_1111_0010_0101; // x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1

function bitLength(value) {
  let length = 0;
  while (value !== 0) {
    length++;
    value >>>= 1;
  }
  return length;
}

/** 15 bit BCH-encoded format information (EC level + mask pattern). */
export function formatInformation(maskPattern) {
  const data = (EC_LEVEL_BITS_M << 3) | maskPattern;
  let remainder = data << 10;
  while (bitLength(remainder) - bitLength(G15) >= 0) {
    remainder ^= G15 << (bitLength(remainder) - bitLength(G15));
  }
  return ((data << 10) | remainder) ^ G15_MASK;
}

/** 18 bit BCH-encoded version information (versions 7 and above). */
export function versionInformation(version) {
  let remainder = version << 12;
  while (bitLength(remainder) - bitLength(G18) >= 0) {
    remainder ^= G18 << (bitLength(remainder) - bitLength(G18));
  }
  return (version << 12) | remainder;
}

/* ------------------------------------------------------------------ *
 * Data encoding
 * ------------------------------------------------------------------ */
function charCountBits(version) {
  return version < 10 ? 8 : 16;
}

function totalDataCodewords(version) {
  const [, groups] = EC_BLOCKS_M[version];
  return groups.reduce((sum, [count, dataCw]) => sum + count * dataCw, 0);
}

function pickVersion(byteLength) {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const requiredBits = 4 + charCountBits(version) + byteLength * 8;
    if (requiredBits <= totalDataCodewords(version) * 8) return version;
  }
  throw new Error(
    `QR: ma'lumot juda uzun (${byteLength} bayt), maksimal hajm ${totalDataCodewords(MAX_VERSION)} bayt atrofida`
  );
}

class BitWriter {
  constructor() {
    this.bits = [];
  }

  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length() {
    return this.bits.length;
  }
}

function toUtf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  return Uint8Array.from(Buffer.from(text, 'utf8'));
}

/** Builds the final (interleaved) codeword stream for the given text. */
function buildCodewords(text) {
  const bytes = toUtf8Bytes(text);
  const version = pickVersion(bytes.length);
  const [ecPerBlock, groups] = EC_BLOCKS_M[version];
  const dataCodewordCount = totalDataCodewords(version);
  const capacityBits = dataCodewordCount * 8;

  const writer = new BitWriter();
  writer.put(MODE_BYTE, 4);
  writer.put(bytes.length, charCountBits(version));
  for (const byte of bytes) writer.put(byte, 8);

  // Terminator (up to four zero bits) and padding to a byte boundary.
  for (let i = 0; i < 4 && writer.length < capacityBits; i++) writer.put(0, 1);
  while (writer.length % 8 !== 0) writer.put(0, 1);

  const dataCodewords = new Uint8Array(dataCodewordCount);
  for (let i = 0; i < writer.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | writer.bits[i + b];
    dataCodewords[i / 8] = byte;
  }
  // Pad codewords 0xEC / 0x11 alternating.
  const PAD = [0xec, 0x11];
  for (let i = writer.length / 8, p = 0; i < dataCodewordCount; i++, p++) {
    dataCodewords[i] = PAD[p % 2];
  }

  // Split into blocks, compute error correction per block.
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [blockCount, blockDataCw] of groups) {
    for (let i = 0; i < blockCount; i++) {
      const block = dataCodewords.subarray(offset, offset + blockDataCw);
      offset += blockDataCw;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecPerBlock));
    }
  }

  // Interleave data codewords, then error correction codewords.
  const result = new Uint8Array(dataCodewordCount + ecPerBlock * dataBlocks.length);
  let index = 0;
  const maxDataLength = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLength; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result[index++] = block[i];
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) result[index++] = block[i];
  }

  return { version, codewords: result };
}

/* ------------------------------------------------------------------ *
 * Matrix construction
 * ------------------------------------------------------------------ */
function maskBit(pattern, row, col) {
  switch (pattern) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: throw new Error(`QR: noto'g'ri mask: ${pattern}`);
  }
}

function emptyMatrix(size) {
  const matrix = new Array(size);
  for (let r = 0; r < size; r++) matrix[r] = new Array(size).fill(null);
  return matrix;
}

function placeFinderPatterns(matrix, size) {
  const origins = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [top, left] of origins) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || col < 0 || row >= size || col >= size) continue;
        const onRing = (r === 0 || r === 6) && c >= 0 && c <= 6;
        const onSide = (c === 0 || c === 6) && r >= 0 && r <= 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[row][col] = onRing || onSide || inCore;
      }
    }
  }
}

function placeTimingPatterns(matrix, size) {
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (matrix[6][i] === null) matrix[6][i] = dark;
    if (matrix[i][6] === null) matrix[i][6] = dark;
  }
}

function placeAlignmentPatterns(matrix, version, size) {
  const centers = ALIGNMENT_CENTERS[version];
  for (const centerRow of centers) {
    for (const centerCol of centers) {
      // Skip the three positions that collide with the finder patterns.
      const nearTopLeft = centerRow === 6 && centerCol === 6;
      const nearTopRight = centerRow === 6 && centerCol === size - 7;
      const nearBottomLeft = centerRow === size - 7 && centerCol === 6;
      if (nearTopLeft || nearTopRight || nearBottomLeft) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          matrix[centerRow + r][centerCol + c] = ring !== 1;
        }
      }
    }
  }
}

function reserveFormatAreas(matrix, version, size) {
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
  }
  matrix[size - 8][8] = true; // dark module
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      if (matrix[a][b] === null) matrix[a][b] = false;
      if (matrix[b][a] === null) matrix[b][a] = false;
    }
  }
}

function writeFormatInformation(matrix, size, maskPattern) {
  const bits = formatInformation(maskPattern);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    let row;
    if (i < 6) row = i;
    else if (i < 8) row = i + 1;
    else row = size - 15 + i;
    matrix[row][8] = dark;

    let col;
    if (i < 8) col = size - 1 - i;
    else if (i < 9) col = 7;
    else col = 14 - i;
    matrix[8][col] = dark;
  }
  matrix[size - 8][8] = true;
}

function writeVersionInformation(matrix, version, size) {
  if (version < 7) return;
  const bits = versionInformation(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    matrix[a][b] = dark;
    matrix[b][a] = dark;
  }
}

/** Zig-zag placement of the codeword bits, applying the mask on the fly. */
function placeData(matrix, size, codewords, maskPattern) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const nextBit = () => {
    if (bitIndex >= totalBits) return false; // remainder bits are zero
    const byte = codewords[bitIndex >> 3];
    const bit = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit === 1;
  };

  let row = size - 1;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing pattern
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const targetCol = col - c;
        if (matrix[row][targetCol] !== null) continue;
        let dark = nextBit();
        if (maskBit(maskPattern, row, targetCol)) dark = !dark;
        matrix[row][targetCol] = dark;
      }
      row += upward ? -1 : 1;
      if (row < 0 || row >= size) {
        row -= upward ? -1 : 1;
        upward = !upward;
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Mask selection (penalty rules 1-4 of the specification)
 * ------------------------------------------------------------------ */
function penaltyScore(matrix, size) {
  let score = 0;

  // Rule 1: runs of five or more modules of the same colour.
  const scoreLine = (get) => {
    let runColor = get(0);
    let runLength = 1;
    for (let i = 1; i < size; i++) {
      const color = get(i);
      if (color === runColor) {
        runLength++;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = color;
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);
  };
  for (let i = 0; i < size; i++) {
    scoreLine((j) => matrix[i][j]);
    scoreLine((j) => matrix[j][i]);
  }

  // Rule 2: 2x2 blocks of the same colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: 1:1:3:1:1 finder-like patterns with four light modules either side.
  const PATTERN = [true, false, true, true, true, false, true];
  const matchesAt = (get, index) => {
    for (let k = 0; k < 7; k++) {
      if (get(index + k) !== PATTERN[k]) return false;
    }
    const lightRun = (from) => {
      for (let k = 0; k < 4; k++) {
        const pos = from + k;
        if (pos < 0 || pos >= size) continue; // outside counts as light (quiet zone)
        if (get(pos) !== false) return false;
      }
      return true;
    };
    return lightRun(index - 4) || lightRun(index + 7);
  };
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - 7; j++) {
      if (matchesAt((k) => matrix[i][k], j)) score += 40;
      if (matchesAt((k) => matrix[k][i], j)) score += 40;
    }
  }

  // Rule 4: deviation of the dark module ratio from 50%.
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (matrix[r][c]) dark++;
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function buildMatrix(version, codewords, maskPattern) {
  const size = version * 4 + 17;
  const matrix = emptyMatrix(size);
  placeFinderPatterns(matrix, size);
  placeTimingPatterns(matrix, size);
  placeAlignmentPatterns(matrix, version, size);
  reserveFormatAreas(matrix, version, size);
  writeVersionInformation(matrix, version, size);
  placeData(matrix, size, codewords, maskPattern);
  writeFormatInformation(matrix, size, maskPattern);
  return matrix;
}

/**
 * Encodes `text` into a QR symbol.
 * @returns {{version:number, mask:number, size:number, modules:boolean[][]}}
 */
export function encode(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('QR: matn bo\u2018sh bo\u2018lishi mumkin emas');
  const { version, codewords } = buildCodewords(value);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = buildMatrix(version, codewords, mask);
    const score = penaltyScore(matrix, matrix.length);
    if (!best || score < best.score) best = { mask, matrix, score };
  }

  return {
    version,
    mask: best.mask,
    size: best.matrix.length,
    modules: best.matrix,
  };
}

/* ------------------------------------------------------------------ *
 * Rendering helpers (browser only)
 * ------------------------------------------------------------------ */
/**
 * Draws a QR code for `text` onto a canvas element.
 *
 * `size` is an upper bound (the canvas never exceeds it), while `minSize`
 * is a lower bound - useful for print/download exports where a guaranteed
 * resolution matters more than an exact pixel size.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {{size?:number, minSize?:number, margin?:number, dark?:string, light?:string}} [options]
 */
export function drawOnCanvas(canvas, text, options = {}) {
  const { size: targetSize = 320, minSize, margin = 4, dark = '#0b1b16', light = '#ffffff' } = options;
  const { modules, size, version, mask } = encode(text);

  const totalModules = size + margin * 2;
  const pixelSize = minSize
    ? Math.max(2, Math.ceil(minSize / totalModules))
    : Math.max(2, Math.floor(targetSize / totalModules));
  const canvasSize = pixelSize * totalModules;
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

  canvas.width = canvasSize * ratio;
  canvas.height = canvasSize * ratio;
  canvas.style.width = `${canvasSize}px`;
  canvas.style.height = `${canvasSize}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.fillStyle = dark;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r][c]) continue;
      ctx.fillRect((c + margin) * pixelSize, (r + margin) * pixelSize, pixelSize, pixelSize);
    }
  }

  return { version, mask, size, pixelSize };
}
