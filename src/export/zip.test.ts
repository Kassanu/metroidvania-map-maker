// The archive is judged by being read back, not by asserting byte offsets.
//
// A reader that walks the central directory the way a zip tool does is the
// only thing that catches the failure this file exists to avoid: a container
// that is off by a few bytes still looks plausible field by field, and some
// tools open it while others reject it.

import { describe, expect, it } from 'vitest'
import { ZipError, buildZip, crc32, endOfCentralDirectory } from './zip'
import { readZip } from './testUtils'

const END_SIGNATURE = 0x06054b50
const ZIP64_END_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50

function entry(name: string, text: string) {
  return { name, bytes: new TextEncoder().encode(text) }
}

describe('crc32', () => {
  it('agrees with the standard vectors', () => {
    expect(crc32(new Uint8Array())).toBe(0)
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new TextEncoder().encode('a'))).toBe(0xe8b7be43)
  })
})

describe('the archive', () => {
  it('round-trips every entry through a real inflater', async () => {
    const contents = [
      entry('one.json', '{"a":1}'),
      entry('two.json', JSON.stringify({ padded: 'x'.repeat(5000) })),
      entry('three.json', ''),
    ]

    const read = await readZip(await buildZip(contents))
    expect(read.map((each) => each.name)).toEqual(['one.json', 'two.json', 'three.json'])
    expect(read.map((each) => each.text)).toEqual([
      '{"a":1}',
      JSON.stringify({ padded: 'x'.repeat(5000) }),
      '',
    ])
  })

  it('stores a checksum the reader can verify', async () => {
    const read = await readZip(await buildZip([entry('a.json', '{"hello":"world"}')]))
    expect(read[0].crcMatches).toBe(true)
  })

  it('keeps a Unicode filename readable', async () => {
    const read = await readZip(await buildZip([entry('日本--room_01.json', '{}')]))
    expect(read[0].name).toBe('日本--room_01.json')
  })

  it('compresses rather than storing', async () => {
    const repetitive = 'x'.repeat(20_000)
    const blob = await buildZip([entry('big.json', repetitive)])
    expect(blob.size).toBeLessThan(repetitive.length / 4)
  })

  it('is a valid empty archive when there is nothing to write', async () => {
    const blob = await buildZip([])
    expect(blob.size).toBe(22)
    expect(await readZip(blob)).toEqual([])
  })

  it('announces itself as a zip', async () => {
    expect((await buildZip([entry('a.json', '{}')])).type).toBe('application/zip')
  })

  it('produces identical bytes for identical input', async () => {
    const once = await buildZip([entry('a.json', '{"a":1}')])
    const twice = await buildZip([entry('a.json', '{"a":1}')])
    expect(new Uint8Array(await once.arrayBuffer())).toEqual(
      new Uint8Array(await twice.arrayBuffer()),
    )
  })

  it('refuses an entry too large for a 32-bit size field', async () => {
    const huge = { name: 'huge.json', bytes: { length: 0x1_0000_0000 } as Uint8Array<ArrayBuffer> }
    await expect(buildZip([huge])).rejects.toBeInstanceOf(ZipError)
  })
})

// Reached by 65,536 real entries and by nothing else, which is why the record
// is assembled by a function of its own.
describe('the end-of-central-directory record', () => {
  function fields(record: Uint8Array) {
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength)
    const end = record.length - 22
    return {
      signature: view.getUint32(end, true),
      count: view.getUint16(end + 10, true),
      size: view.getUint32(end + 12, true),
      offset: view.getUint32(end + 16, true),
      length: record.length,
    }
  }

  it('holds the real numbers while they fit', () => {
    const record = endOfCentralDirectory(3, 150, 900)
    expect(fields(record)).toEqual({
      signature: END_SIGNATURE,
      count: 3,
      size: 150,
      offset: 900,
      length: 22,
    })
  })

  it('carries sentinels and a Zip64 record once the count overflows', () => {
    const count = 70_000
    const size = 46 * count
    const offset = 1_000_000
    const record = endOfCentralDirectory(count, size, offset)

    // The size and offset here still fit, and keep their real values: only the
    // field that overflowed is sentinelled.
    expect(fields(record)).toMatchObject({ count: 0xffff, size, offset })

    const view = new DataView(record.buffer, record.byteOffset, record.byteLength)
    expect(view.getUint32(0, true)).toBe(ZIP64_END_SIGNATURE)
    expect(view.getBigUint64(24, true)).toBe(BigInt(count))
    expect(view.getBigUint64(40, true)).toBe(BigInt(size))
    expect(view.getBigUint64(48, true)).toBe(BigInt(offset))

    // The locator follows the Zip64 record and points back at where it began,
    // which is the end of the central directory it describes.
    expect(view.getUint32(56, true)).toBe(ZIP64_LOCATOR_SIGNATURE)
    expect(view.getBigUint64(64, true)).toBe(BigInt(offset + size))
    expect(record.length).toBe(56 + 20 + 22)
  })

  it('overflows on a directory past four gigabytes as well as on a count', () => {
    const record = endOfCentralDirectory(2, 40, 0x1_0000_0000)
    expect(record.length).toBe(56 + 20 + 22)
    expect(fields(record).offset).toBe(0xffffffff)
    // The count still fits, and is reported honestly in the classic record.
    expect(fields(record).count).toBe(2)
  })
})
