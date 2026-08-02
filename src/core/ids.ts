// Stable ids for everything the file cross-references. Short generated unique
// ids on maps, rooms, areas, and lock types.
//
// Branded string types rather than bare `string`: this is a data-model-heavy
// tool where a RoomId and an AreaId are both short strings, and passing one
// where the other belongs is the single easiest mistake to make. The brand is
// erased at build time, so it costs nothing at runtime.
declare const brand: unique symbol
type Branded<T extends string> = string & { readonly [brand]: T }

export type MapId = Branded<'MapId'>
export type RoomId = Branded<'RoomId'>
export type AreaId = Branded<'AreaId'>
export type LockTypeId = Branded<'LockTypeId'>
export type TransitionId = Branded<'TransitionId'>
export type IconId = Branded<'IconId'>
export type LineId = Branded<'LineId'>

// The two immutable fallbacks: `World` (every room's area) and `Open` (every
// transition end's lock type). Both are un-deletable, un-renamable, and
// un-recolorable. Their ids are reserved so a loaded file can never define a
// second one, and the delete/rename guards have something to compare against.
export const WORLD_AREA_ID = 'world' as AreaId
export const OPEN_LOCK_ID = 'open' as LockTypeId

// Short random ids instead of UUIDs (36 chars each would dominate a saved file)
// and instead of a `nextId` counter (which restarts at 1 on reload and ignores
// ids in a project just opened).
//
// 8 chars of base32 is 40 bits; at a few thousand objects per project the
// collision probability is negligible, and `uniqueId` below still checks
// against the live set so "negligible" never has to mean "trusted".
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const ID_LENGTH = 8

function randomSuffix(): string {
  const bytes = new Uint8Array(ID_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}

// Prefixed so a raw JSON file stays readable and a stray id in a debugger
// says what it points at: "room_k3f9a2xy", "tr_8d2mnp04".
export function newId<T extends string>(prefix: string): Branded<T> {
  return `${prefix}_${randomSuffix()}` as Branded<T>
}

// Same as `newId`, but guaranteed not to collide with ids in `taken`. Used when
// generating ids into a project loaded from disk, where existing ids came from
// elsewhere (another machine, hand-edited file, future import/merge).
export function uniqueId<T extends string>(
  prefix: string,
  taken: { has(id: string): boolean },
): Branded<T> {
  let id = newId<T>(prefix)
  while (taken.has(id)) id = newId<T>(prefix)
  return id
}

// A source of ids that hands back the same ones when replayed. A drag
// re-applies its operation on every pointer move, and anything created gets
// created afresh each time. Without id caching, a split-off room or door made
// from a box drag changes identity every frame, staling any gesture-layer
// state holding onto it (selection, hover, Hierarchy row).
//
// Ids are cached per prefix in mint order, so `rewind` makes a re-run reuse
// them positionally. Extra ids from a pointer move that creates more objects
// are new; earlier ones still match. When fewer objects are created, the
// unused tail returns if the pointer comes back. Per-prefix caching ensures
// a run creating a transition before a room cannot be handed a room's id.
export interface IdSource {
  mint<T extends string>(prefix: string): Branded<T>
  rewind(): void
}

export function createIdSource(): IdSource {
  const pools = new Map<string, { ids: string[]; next: number }>()
  return {
    mint<T extends string>(prefix: string): Branded<T> {
      let pool = pools.get(prefix)
      if (!pool) {
        pool = { ids: [], next: 0 }
        pools.set(prefix, pool)
      }
      if (pool.next === pool.ids.length) pool.ids.push(newId<T>(prefix))
      return pool.ids[pool.next++] as Branded<T>
    },
    rewind(): void {
      for (const pool of pools.values()) pool.next = 0
    },
  }
}

export const newMapId = () => newId<'MapId'>('map')
export const newRoomId = () => newId<'RoomId'>('room')
export const newAreaId = () => newId<'AreaId'>('area')
export const newLockTypeId = () => newId<'LockTypeId'>('lock')
export const newTransitionId = () => newId<'TransitionId'>('tr')
export const newIconId = () => newId<'IconId'>('ic')
export const newLineId = () => newId<'LineId'>('ln')
