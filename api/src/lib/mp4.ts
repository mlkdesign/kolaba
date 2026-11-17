// A video's length from the file itself (ISO BMFF: MP4 / QuickTime .mov), read from R2 with small ranged reads — the
// file is never loaded whole. Top-level boxes are walked to 'moov', then its children to 'mvhd' (timescale + duration).

const MAX_BOXES = 64;

async function readRange(bucket: R2Bucket, key: string, offset: number, length: number): Promise<Uint8Array | null> {
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
}

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const type = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** The box at `offset` (within [offset, end)): its type, header size and total size, or null. */
async function boxAt(bucket: R2Bucket, key: string, offset: number, end: number) {
  if (offset + 8 > end) return null;
  const head = await readRange(bucket, key, offset, Math.min(16, end - offset));
  if (!head || head.length < 8) return null;
  let size = u32(head, 0);
  let header = 8;
  if (size === 1) {
    if (head.length < 16) return null;
    size = u64(head, 8);
    header = 16;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < header || offset + size > end) return null;
  return { type: type(head, 4), header, size };
}

/** Seconds, or null when the file has no readable movie header. */
export async function mp4DurationSeconds(bucket: R2Bucket, key: string, fileSize: number): Promise<number | null> {
  let offset = 0;
  for (let i = 0; i < MAX_BOXES && offset < fileSize; i++) {
    const box = await boxAt(bucket, key, offset, fileSize);
    if (!box) return null;
    if (box.type === 'moov') {
      const end = offset + box.size;
      let child = offset + box.header;
      for (let j = 0; j < MAX_BOXES && child < end; j++) {
        const inner = await boxAt(bucket, key, child, end);
        if (!inner) return null;
        if (inner.type === 'mvhd') {
          const body = await readRange(bucket, key, child + inner.header, Math.min(32, inner.size - inner.header));
          if (!body || body.length < 20) return null;
          const version = body[0];
          const timescale = version === 1 ? u32(body, 20) : u32(body, 12);
          const duration = version === 1 ? (body.length >= 32 ? u64(body, 24) : NaN) : u32(body, 16);
          if (!timescale || !Number.isFinite(duration)) return null;
          return duration / timescale;
        }
        child += inner.size;
      }
      return null;
    }
    offset += box.size;
  }
  return null;
}

/** Pure parse of a whole file in memory (tests). */
export function mp4DurationFromBytes(bytes: Uint8Array): number | null {
  const walk = (start: number, end: number, want: string): [number, number, number] | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = u32(bytes, at); let header = 8;
      if (size === 1) { size = u64(bytes, at + 8); header = 16; } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return null;
      if (type(bytes, at + 4) === want) return [at, header, size];
      at += size;
    }
    return null;
  };
  const moov = walk(0, bytes.length, 'moov');
  if (!moov) return null;
  const mvhd = walk(moov[0] + moov[1], moov[0] + moov[2], 'mvhd');
  if (!mvhd) return null;
  const b = bytes.subarray(mvhd[0] + mvhd[1]);
  const version = b[0];
  const timescale = version === 1 ? u32(b, 20) : u32(b, 12);
  const duration = version === 1 ? u64(b, 24) : u32(b, 16);
  return timescale ? duration / timescale : null;
}
