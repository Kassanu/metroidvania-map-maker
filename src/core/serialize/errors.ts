// The refusals, in their own module so the loader and the migration chain can
// both raise them without importing each other.
//
// `index.ts` re-exports InvalidFileError, which is where every caller reads it
// from.

// The file is not one this build can read at all: not the format, not an
// object, no maps, or shaped so it cannot be walked.
export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFileError'
  }
}
