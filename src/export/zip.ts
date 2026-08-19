// A zip writer, hand-written because the browser already has the hard part.
//
// `CompressionStream('deflate-raw')` produces exactly the bytes a zip entry
// holds for method 8, so all that is left is the container: a local header per
// entry, a central directory describing them again, and an end-of-central-
// directory record pointing at that. No dependency, and nothing here is
// clever.
//
// Everything is little-endian, and every offset is a byte count from the start
// of the archive.
//
// Two deliberate limits:
//
//   * Entries larger than 4 GB are not supported. That needs per-entry Zip64
//     extra fields, and a room's JSON cannot approach it.
//   * The whole archive is assembled in memory. It is bounded by what the
//     project holds, and streaming would buy nothing at that size.
//
// Above 65,535 entries, or a directory that starts past 4 GB, the classic
// end-of-central-directory record cannot hold the numbers, so a Zip64 record
// is written and the classic one carries sentinel values. Readers that
// understand Zip64 use the former; ones that do not at least fail loudly
// rather than reading a truncated count as the truth.

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const ZIP64_END_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50

// The value a 16- or 32-bit field carries when the real one lives in a Zip64
// record instead.
const U16_MAX = 0xffff
const U32_MAX = 0xffffffff

// Bit 11: filenames and comments are UTF-8. Set unconditionally, because a
// slug keeps Unicode letters and a reader must not guess at a code page.
const UTF8_FLAG = 0x0800

const DEFLATED = 8

// 1980-01-01 00:00:00, the earliest a DOS timestamp can express.
//
// Fixed rather than the clock, so re-exporting an unchanged project produces
// an identical archive. A date that moved on every export would make two
// exports of the same map differ in bytes while agreeing in content.
const DOS_TIME = 0
const DOS_DATE = 0x0021

const MAX_ENTRY_BYTES = U32_MAX

export const ZIP_MEDIA_TYPE = 'application/zip'

export interface ZipEntry {
  // Stored verbatim as the path inside the archive, encoded UTF-8.
  name: string
  // Backed by a plain ArrayBuffer, which is what the compression stream takes:
  // a shared buffer cannot be handed to it.
  bytes: Uint8Array<ArrayBuffer>
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const parts: Uint8Array[] = []
  const directory: CentralRecord[] = []
  let offset = 0

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    if (entry.bytes.length > MAX_ENTRY_BYTES) {
      throw new ZipError(`${entry.name} is too large for this archive`)
    }

    const compressed = await deflateRaw(entry.bytes)
    const crc = crc32(entry.bytes)

    parts.push(localHeader(name, crc, compressed.length, entry.bytes.length), name, compressed)
    directory.push({
      name,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: entry.bytes.length,
      offset,
    })
    offset += LOCAL_HEADER_BYTES + name.length + compressed.length
  }

  const directoryOffset = offset
  let directorySize = 0
  for (const record of directory) {
    const header = centralHeader(record)
    parts.push(header, record.name)
    directorySize += header.length + record.name.length
  }

  parts.push(endOfCentralDirectory(directory.length, directorySize, directoryOffset))
  return new Blob(parts as BlobPart[], { type: ZIP_MEDIA_TYPE })
}

interface CentralRecord {
  name: Uint8Array
  crc: number
  compressedSize: number
  uncompressedSize: number
  offset: number
}

const LOCAL_HEADER_BYTES = 30
const CENTRAL_HEADER_BYTES = 46

function localHeader(
  name: Uint8Array,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
): Uint8Array {
  const buffer = new Uint8Array(LOCAL_HEADER_BYTES)
  const view = new DataView(buffer.buffer)
  view.setUint32(0, LOCAL_HEADER_SIGNATURE, true)
  view.setUint16(4, 20, true) // version needed: 2.0, the floor for deflate
  view.setUint16(6, UTF8_FLAG, true)
  view.setUint16(8, DEFLATED, true)
  view.setUint16(10, DOS_TIME, true)
  view.setUint16(12, DOS_DATE, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, compressedSize, true)
  view.setUint32(22, uncompressedSize, true)
  view.setUint16(26, name.length, true)
  view.setUint16(28, 0, true) // extra field length
  return buffer
}

function centralHeader(record: CentralRecord): Uint8Array {
  const buffer = new Uint8Array(CENTRAL_HEADER_BYTES)
  const view = new DataView(buffer.buffer)
  view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true)
  view.setUint16(4, 20, true) // version made by
  view.setUint16(6, 20, true) // version needed
  view.setUint16(8, UTF8_FLAG, true)
  view.setUint16(10, DEFLATED, true)
  view.setUint16(12, DOS_TIME, true)
  view.setUint16(14, DOS_DATE, true)
  view.setUint32(16, record.crc, true)
  view.setUint32(20, record.compressedSize, true)
  view.setUint32(24, record.uncompressedSize, true)
  view.setUint16(28, record.name.length, true)
  view.setUint16(30, 0, true) // extra field length
  view.setUint16(32, 0, true) // comment length
  view.setUint16(34, 0, true) // disk number
  view.setUint16(36, 0, true) // internal attributes
  view.setUint32(38, 0, true) // external attributes
  view.setUint32(42, record.offset, true)
  return buffer
}

// The trailer, plus the Zip64 pair when any of its fields would overflow.
//
// Exported because the overflow path is otherwise only reachable by building
// an archive of 65,536 real entries, which is not a test anyone should have to
// wait for.
export function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  // Sentinelled per field rather than all at once: a field that still fits
  // keeps its real value, so a reader that ignores Zip64 gets as much truth as
  // the classic record can hold.
  const countOverflows = count > U16_MAX
  const sizeOverflows = size > U32_MAX
  const offsetOverflows = offset > U32_MAX
  const needsZip64 = countOverflows || sizeOverflows || offsetOverflows

  const classic = new Uint8Array(22)
  const view = new DataView(classic.buffer)
  view.setUint32(0, END_SIGNATURE, true)
  view.setUint16(4, 0, true) // this disk
  view.setUint16(6, 0, true) // disk the directory starts on
  view.setUint16(8, countOverflows ? U16_MAX : count, true)
  view.setUint16(10, countOverflows ? U16_MAX : count, true)
  view.setUint32(12, sizeOverflows ? U32_MAX : size, true)
  view.setUint32(16, offsetOverflows ? U32_MAX : offset, true)
  view.setUint16(20, 0, true) // comment length

  if (!needsZip64) return classic
  return concat([zip64End(count, size, offset), zip64Locator(offset + size), classic])
}

function zip64End(count: number, size: number, offset: number): Uint8Array {
  const buffer = new Uint8Array(56)
  const view = new DataView(buffer.buffer)
  view.setUint32(0, ZIP64_END_SIGNATURE, true)
  // Size of this record minus the 12 bytes up to and including this field.
  view.setBigUint64(4, BigInt(buffer.length - 12), true)
  view.setUint16(12, 45, true) // version made by: 4.5, the one that added Zip64
  view.setUint16(14, 45, true) // version needed
  view.setUint32(16, 0, true) // this disk
  view.setUint32(20, 0, true) // disk the directory starts on
  view.setBigUint64(24, BigInt(count), true)
  view.setBigUint64(32, BigInt(count), true)
  view.setBigUint64(40, BigInt(size), true)
  view.setBigUint64(48, BigInt(offset), true)
  return buffer
}

function zip64Locator(zip64EndOffset: number): Uint8Array {
  const buffer = new Uint8Array(20)
  const view = new DataView(buffer.buffer)
  view.setUint32(0, ZIP64_LOCATOR_SIGNATURE, true)
  view.setUint32(4, 0, true) // disk holding the Zip64 end record
  view.setBigUint64(8, BigInt(zip64EndOffset), true)
  view.setUint32(16, 1, true) // total disks
  return buffer
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

// Raw deflate: the stream with no zlib wrapper, which is exactly what a zip
// entry stores. There is no stored-method fallback on purpose. A missing
// `CompressionStream` is a platform that moved, and failing here says so,
// where quietly writing a different archive would not.
async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new ZipError('this browser cannot compress')
  }
  // Fed through a writer rather than `Blob.stream()`: the blob method is the
  // shorter spelling and is missing from the DOM implementation the tests run
  // against, which would leave this path covered nowhere.
  const compressor = new CompressionStream('deflate-raw')
  const writer = compressor.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  return new Uint8Array(await new Response(compressor.readable).arrayBuffer())
}

// ---------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------

// The standard polynomial in reversed form, which is the one every zip tool
// agrees on. The table is built once: 256 entries against a per-byte loop over
// every byte of every file.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  // Unsigned, because every field it is written into is.
  return (crc ^ 0xffffffff) >>> 0
}
