// https://wiki.openstreetmap.org/wiki/Precision_of_coordinates
const PRECISION = 5;
const SCALE = 10 ** PRECISION;

function zigzag(value) {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function unzigzag(value) {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function writeVarint(out, value) {
  while (value > 0x7f) {
    out.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  out.push(value);
}

function readVarint(buffer, position) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    byte = buffer[position.value++];
    if (byte === undefined) {
      throw new Error('Unexpected end of data');
    }

    value |= (byte & 0x7f) << shift;

    shift += 7;
    if (shift > 35) {
      throw new Error('Corrupt data: varint too long');
    }
  } while (byte & 0x80);
  return value >>> 0;
}

const textEncoder = new TextEncoder();

function writeString(out, string) {
  if (string == null) {
    out.push(0);
    return;
  }

  const bytes = textEncoder.encode(string);
  writeVarint(out, bytes.length + 1);
  for (const byte of bytes) {
    out.push(byte);
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });

function readString(buffer, position) {
  const size = readVarint(buffer, position);
  if (size === 0) {
    return null;
  }

  const length = size - 1;
  if (position.value + length > buffer.length) {
    throw new Error('Unexpected end of data');
  }

  const string = textDecoder.decode(buffer.subarray(position.value, position.value + length));
  position.value += length;
  return string;
}

/**
 * @param {Array<Array<[number, number]>>} polylines
 * @param {Array<Array<string|null>>} metadata
 * @returns {Uint8Array}
 */
export function encode(polylines, metadata = []) {
  const out = [];

  writeVarint(out, polylines.length);
  for (const polyline of polylines) {
    writeVarint(out, polyline.length);
  }

  for (const axis of [0, 1]) {
    let previous = 0;
    for (const polyline of polylines) {
      for (const coordinates of polyline) {
        const coordinate = coordinates[axis];
        if (!Number.isFinite(coordinate)) {
          throw new Error('Coordinates must be finite numbers');
        }

        const quantized = Math.round(coordinate * SCALE);
        writeVarint(out, zigzag(quantized - previous));
        previous = quantized;
      }
    }
  }

  writeVarint(out, metadata.length);
  for (const items of metadata) {
    writeVarint(out, items.length);
    for (const item of items) {
      writeString(out, item);
    }
  }

  return Uint8Array.from(out);
}

/**
 * @param {Uint8Array} buffer
 * @returns {{ polylines: Array<Array<[number, number]>>, metadata: Array<Array<string|null>> }}
 */
export function decode(buffer) {
  if (!(buffer instanceof Uint8Array)) {
    throw new Error('Invalid data');
  }

  const position = { value: 0 };

  const polylineCount = readVarint(buffer, position);
  if (buffer.length - position.value < polylineCount) {
    throw new Error('Corrupt data: polyline count too large');
  }

  const polylineLengths = [];
  for (let i = 0; i < polylineCount; i++) {
    polylineLengths.push(readVarint(buffer, position));
  }

  const totalCoordinates = polylineLengths.reduce((a, b) => a + b, 0);
  if (buffer.length - position.value < totalCoordinates * 2) {
    throw new Error('Corrupt data: point count too large');
  }

  const polylines = polylineLengths.map((length) => Array.from({ length }, () => [0, 0]));

  for (const axis of [0, 1]) {
    let previous = 0;
    for (const polyline of polylines) {
      for (let i = 0; i < polyline.length; i++) {
        previous += unzigzag(readVarint(buffer, position));
        polyline[i][axis] = previous / SCALE;
      }
    }
  }

  const metadataCount = readVarint(buffer, position);
  if (buffer.length - position.value < metadataCount) {
    throw new Error('Corrupt data: metadata count too large');
  }

  const metadata = Array.from({ length: metadataCount }, () => {
    const length = readVarint(buffer, position);
    if (buffer.length - position.value < length) {
      throw new Error('Corrupt data: string count too large');
    }

    const strings = [];
    for (let i = 0; i < length; i++) {
      strings.push(readString(buffer, position));
    }
    return strings;
  });

  return { polylines, metadata };
}

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

export function compress(bytes) {
  return pipe(bytes, new CompressionStream('deflate-raw'));
}

export function decompress(bytes) {
  return pipe(bytes, new DecompressionStream('deflate-raw'));
}
