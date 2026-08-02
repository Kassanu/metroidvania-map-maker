// The return convention, in one place.
//
// One rule: the return type answers what can the caller do about this.
//
//   | Situation                                   | Return        |
//   |---------------------------------------------|---------------|
//   | Nothing to say, it just happened            | `void`        |
//   | The caller needs the thing that was made    | the thing     |
//   | A domain rule refused, and the UI must say why | `Refused` union |
//   | A bad id, or a state that cannot legally arise | throw |
//   | Asking a question rather than doing a thing | `boolean`, named `is*` / `has*` / `can*` |
//
// The two lines that matter most:
//
// A rule refusing is a normal outcome: "World cannot be renamed", "that cell
// already has an icon". The user did something the model declines, and the UI
// must tell them which thing. A bare `false` cannot.
//
// A missing id is a bug. Nothing in the app should ever hand an op an id that
// is not in the map. A silent no-op hides a stale selection or a broken bridge
// until it becomes a mystery later. Throwing turns that into a stack trace at
// the moment it happens.
//
// `false` disappears from mutating ops entirely. It only ever meant one of
// those two things, and it could not say which.

// A refusal carries a machine-readable reason, so the chrome can map it to a
// translated message rather than inventing one from a boolean.
export interface Refused<R extends string = RefusalReason> {
  refused: R
}

export type RefusalReason =
  // Areas / lock types
  | 'immutable' // World and Open cannot be renamed, recoloured or deleted
  // Icons
  | 'cell-occupied' // an icon is already here and `replace` is off
  | 'not-in-a-room' // an endpoint on bare grid: icon placement, teleport ends
  // Transitions
  | 'same-room' // a teleport's two ends must be in different rooms
  | 'teleport-exists' // at most one teleport per cell
  | 'no-valid-connection' // a box drag that classifies to nothing
  // Lines
  | 'too-short' // a line needs at least one segment
  // Rooms
  | 'not-interior' // an inner wall must have both cells in the same room

export function refuse<R extends RefusalReason>(reason: R): Refused<R> {
  return { refused: reason }
}

// Narrowing helper, so call sites read as a question rather than a property
// poke. `if (wasRefused(result)) return show(result.refused)`.
export function wasRefused<T>(result: T | Refused): result is Refused {
  return typeof result === 'object' && result !== null && 'refused' in result
}

// The result of an op that either does the thing or declines with a reason.
// `Outcome<void>` is the "did it, or refused" shape; `Outcome<Room>` hands back
// what it made.
export type Outcome<T = void> = T | Refused

// ---------------------------------------------------------------------------
// Programmer errors
// ---------------------------------------------------------------------------

// Thrown when an op is handed an id that does not exist, or asked to work on a
// state that cannot legally arise. Distinct from `Refused`: this is never
// something to show a user, and never something to recover from. It means the
// caller is wrong.
export class ModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelError'
  }
}

// Look-ups that assert rather than return undefined. The `kind` is only for the
// message, so a thrown error names what was missing without the caller having
// to build the string.
export function mustGet<K, V>(collection: Map<K, V>, key: K, kind: string): V {
  const value = collection.get(key)
  if (value === undefined) throw new ModelError(`no ${kind} with id ${String(key)}`)
  return value
}

export function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new ModelError(message)
  return value
}
