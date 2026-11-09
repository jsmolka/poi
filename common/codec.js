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

function readVarint(buffer, state) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    byte = buffer[state.position++];
    if (byte === undefined) {
      throw new Error('Unexpected end of data');
    }
    value |= (byte & 0x7f) << shift;
    shift += 7;
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

function readString(buffer, state) {
  const size = readVarint(buffer, state);
  if (size === 0) {
    return null;
  }

  const length = size - 1;
  const string = textDecoder.decode(buffer.subarray(state.position, state.position + length));
  state.position += length;
  return string;
}

export function encode(polylines, metadata) {
  const out = [];

  writeVarint(out, polylines.length + 1);
  writeVarint(out, 0);
  for (const polyline of polylines) {
    writeVarint(out, polyline.length);
  }

  const previous = [0, 0];
  for (const polyline of polylines) {
    for (const coordinates of polyline) {
      for (const [index, coordinate] of coordinates.entries()) {
        const quantized = Math.round(coordinate * SCALE);
        writeVarint(out, zigzag(quantized - previous[index]));
        previous[index] = quantized;
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

export function decode(buffer) {
  const state = { position: 0 };

  let startIndex = 0;
  const startIndices = Uint32Array.from({ length: readVarint(buffer, state) }, () => {
    startIndex += readVarint(buffer, state);
    return startIndex;
  });

  const previous = [0, 0];
  const positions = Float64Array.from({ length: 2 * startIndices.at(-1) }, (_, index) => {
    previous[index & 0x1] += unzigzag(readVarint(buffer, state));
    return previous[index & 0x1] / SCALE;
  });

  const metadata = Array.from({ length: readVarint(buffer, state) }, () => {
    return Array.from({ length: readVarint(buffer, state) }, () => {
      return readString(buffer, state);
    });
  });

  return { positions, startIndices, metadata };
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
