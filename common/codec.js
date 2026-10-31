const PRECISION = 5;

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

  const previous = [0, 0];
  writeVarint(out, polylines.length);
  for (const polyline of polylines) {
    writeVarint(out, polyline.length);
    for (const coordinates of polyline) {
      for (const [index, coordinate] of coordinates.entries()) {
        const quantized = Math.round(coordinate * 10 ** PRECISION);
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
  const previous = [0, 0];
  const state = { position: 0 };

  return {
    polylines: Array.from({ length: readVarint(buffer, state) }, () => {
      return Float32Array.from({ length: 2 * readVarint(buffer, state) }, (_, index) => {
        previous[index & 0x1] += unzigzag(readVarint(buffer, state));
        return previous[index & 0x1] / 10 ** PRECISION;
      });
    }),

    metadata: Array.from({ length: readVarint(buffer, state) }, () => {
      return Array.from({ length: readVarint(buffer, state) }, () => {
        return readString(buffer, state);
      });
    }),
  };
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
