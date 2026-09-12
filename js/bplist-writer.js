/**
 * Minimal, dependency-free binary property list (bplist v0) writer.
 *
 * Supports the small subset of plist types needed to build an iOS
 * Shortcuts (.shortcut) file entirely client-side, in the browser:
 *   - dictionaries (plain JS objects)
 *   - arrays
 *   - strings (ASCII or UTF-16BE, auto-detected)
 *   - integers (whole numbers)
 *   - booleans
 *
 * This intentionally implements just enough of Apple's CFBinaryPlist
 * format (as used by the Shortcuts app) to be correct and small; it is
 * not a general-purpose plist library.
 */
(function (global) {
  'use strict';

  // ---- Byte buffer helper -------------------------------------------------

  function ByteWriter() {
    this.chunks = [];
    this.length = 0;
  }
  ByteWriter.prototype.push = function (bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  };
  ByteWriter.prototype.toUint8Array = function () {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };

  function bytesForUint(n) {
    // Smallest power-of-two byte size (1, 2, 4, 8) that can hold n unsigned.
    if (n <= 0xff) return 1;
    if (n <= 0xffff) return 2;
    if (n <= 0xffffffff) return 4;
    return 8;
  }

  function writeUIntBE(value, byteLength) {
    const out = new Uint8Array(byteLength);
    // Use BigInt for correctness with 8-byte values beyond 2^53.
    let big = BigInt(Math.trunc(value));
    for (let i = byteLength - 1; i >= 0; i--) {
      out[i] = Number(big & 0xffn);
      big >>= 8n;
    }
    return out;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
  }

  // ---- Object graph flattening --------------------------------------------

  // Every distinct value (by identity for containers, by value for
  // primitives) becomes one entry in the flat "object table". Containers
  // store the table indices of their children so they can be re-encoded
  // once every index is known.

  function BPlistBuilder() {
    this.table = []; // entries: {kind, value, childRefs?}
    this.stringCache = new Map();
    this.intCache = new Map();
    this.boolCache = new Map();
  }

  BPlistBuilder.prototype.addString = function (str) {
    if (this.stringCache.has(str)) return this.stringCache.get(str);
    const idx = this.table.length;
    this.table.push({ kind: 'string', value: str });
    this.stringCache.set(str, idx);
    return idx;
  };

  BPlistBuilder.prototype.addInt = function (num) {
    if (this.intCache.has(num)) return this.intCache.get(num);
    const idx = this.table.length;
    this.table.push({ kind: 'int', value: num });
    this.intCache.set(num, idx);
    return idx;
  };

  BPlistBuilder.prototype.addBool = function (b) {
    if (this.boolCache.has(b)) return this.boolCache.get(b);
    const idx = this.table.length;
    this.table.push({ kind: 'bool', value: b });
    this.boolCache.set(b, idx);
    return idx;
  };

  BPlistBuilder.prototype.addValue = function (value) {
    if (typeof value === 'string') return this.addString(value);
    if (typeof value === 'boolean') return this.addBool(value);
    if (typeof value === 'number') return this.addInt(value);
    if (Array.isArray(value)) return this.addArray(value);
    if (isPlainObject(value)) return this.addDict(value);
    if (value === null || value === undefined) return this.addString('');
    throw new Error('Unsupported plist value type: ' + typeof value);
  };

  BPlistBuilder.prototype.addArray = function (arr) {
    const idx = this.table.length;
    const entry = { kind: 'array', childRefs: [] };
    this.table.push(entry);
    for (const item of arr) {
      entry.childRefs.push(this.addValue(item));
    }
    return idx;
  };

  BPlistBuilder.prototype.addDict = function (obj) {
    const idx = this.table.length;
    const entry = { kind: 'dict', keyRefs: [], valueRefs: [] };
    this.table.push(entry);
    for (const key of Object.keys(obj)) {
      entry.keyRefs.push(this.addString(key));
      entry.valueRefs.push(this.addValue(obj[key]));
    }
    return idx;
  };

  // ---- Object encoding -----------------------------------------------------

  function encodeLength(marker4, length) {
    // marker4: the high nibble for this type (e.g. 0x5 for ASCII string).
    if (length < 15) {
      return { header: new Uint8Array([(marker4 << 4) | length]) };
    }
    const sizeBytes = bytesForUint(length);
    const pow = sizeBytes === 1 ? 0 : sizeBytes === 2 ? 1 : sizeBytes === 4 ? 2 : 3;
    const lenInt = writeUIntBE(length, Math.pow(2, pow));
    const header = new Uint8Array(2 + lenInt.length);
    header[0] = (marker4 << 4) | 0x0f;
    header[1] = 0x10 | pow;
    header.set(lenInt, 2);
    return { header };
  }

  function encodeInt(num) {
    const negative = num < 0;
    let size = bytesForUint(negative ? -num * 2 : num); // rough sizing; refine below
    // Integers are stored in the smallest of 1/2/4/8 bytes that represents
    // the value as a (possibly negative) two's-complement number.
    if (!negative) {
      size = bytesForUint(num);
    } else {
      // Negative values: choose the smallest size where two's complement
      // representation round-trips correctly (be generous and use 8 bytes
      // for any negative number to keep this simple and always correct).
      size = 8;
    }
    const pow = size === 1 ? 0 : size === 2 ? 1 : size === 4 ? 2 : 3;
    const marker = new Uint8Array([0x10 | pow]);
    let bytes;
    if (!negative) {
      bytes = writeUIntBE(num, size);
    } else {
      let big = BigInt(Math.trunc(num));
      big = big & ((1n << 64n) - 1n); // two's complement in 64 bits
      bytes = new Uint8Array(8);
      for (let i = 7; i >= 0; i--) {
        bytes[i] = Number(big & 0xffn);
        big >>= 8n;
      }
    }
    const out = new Uint8Array(marker.length + bytes.length);
    out.set(marker, 0);
    out.set(bytes, marker.length);
    return out;
  }

  function isAscii(str) {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) return false;
    }
    return true;
  }

  function encodeString(str) {
    if (isAscii(str)) {
      const { header } = encodeLength(0x5, str.length);
      const body = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) body[i] = str.charCodeAt(i);
      const out = new Uint8Array(header.length + body.length);
      out.set(header, 0);
      out.set(body, header.length);
      return out;
    }
    // UTF-16BE fallback for non-ASCII text (e.g. accented names).
    const { header } = encodeLength(0x6, str.length);
    const body = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      body[i * 2] = (code >> 8) & 0xff;
      body[i * 2 + 1] = code & 0xff;
    }
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  function encodeRef(idx, refSize) {
    return writeUIntBE(idx, refSize);
  }

  function encodeArray(entry, refSize) {
    const { header } = encodeLength(0xa, entry.childRefs.length);
    const body = new Uint8Array(entry.childRefs.length * refSize);
    entry.childRefs.forEach((ref, i) => body.set(encodeRef(ref, refSize), i * refSize));
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  function encodeDict(entry, refSize) {
    const { header } = encodeLength(0xd, entry.keyRefs.length);
    const body = new Uint8Array((entry.keyRefs.length + entry.valueRefs.length) * refSize);
    let offset = 0;
    entry.keyRefs.forEach((ref) => {
      body.set(encodeRef(ref, refSize), offset);
      offset += refSize;
    });
    entry.valueRefs.forEach((ref) => {
      body.set(encodeRef(ref, refSize), offset);
      offset += refSize;
    });
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  function encodeBool(b) {
    return new Uint8Array([b ? 0x09 : 0x08]);
  }

  /**
   * Serialize a plain JS value (object/array/string/number/boolean tree)
   * into a binary plist (bplist00) as a Uint8Array.
   */
  function createBinaryPlist(rootValue) {
    const builder = new BPlistBuilder();
    const rootIdx = builder.addValue(rootValue);
    const numObjects = builder.table.length;
    const refSize = bytesForUint(Math.max(numObjects - 1, 0)) || 1;

    // Pass 1: encode every object's bytes now that refSize is known.
    const encoded = builder.table.map((entry) => {
      switch (entry.kind) {
        case 'string':
          return encodeString(entry.value);
        case 'int':
          return encodeInt(entry.value);
        case 'bool':
          return encodeBool(entry.value);
        case 'array':
          return encodeArray(entry, refSize);
        case 'dict':
          return encodeDict(entry, refSize);
        default:
          throw new Error('Unknown entry kind: ' + entry.kind);
      }
    });

    const writer = new ByteWriter();
    writer.push(new TextEncoder().encode('bplist00'));

    const offsets = [];
    for (const bytes of encoded) {
      offsets.push(writer.length);
      writer.push(bytes);
    }

    const offsetTableOffset = writer.length;
    const offsetIntSize = bytesForUint(offsetTableOffset) || 1;
    for (const off of offsets) {
      writer.push(writeUIntBE(off, offsetIntSize));
    }

    // Trailer (32 bytes)
    const trailer = new Uint8Array(32);
    trailer[6] = offsetIntSize;
    trailer[7] = refSize;
    trailer.set(writeUIntBE(numObjects, 8), 8);
    trailer.set(writeUIntBE(rootIdx, 8), 16);
    trailer.set(writeUIntBE(offsetTableOffset, 8), 24);
    writer.push(trailer);

    return writer.toUint8Array();
  }

  global.BPlistWriter = { createBinaryPlist };
})(typeof window !== 'undefined' ? window : globalThis);
