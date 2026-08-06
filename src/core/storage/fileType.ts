// What the app calls its own files, in one place with no dependencies.
//
// Separate from `provider.ts` because the build config reads these to register
// the file association, and that config is type-checked under Node's
// resolution with no DOM library. Anything importing the provider interface
// from there would pull `FileSystemFileHandle` into a program that has never
// heard of it.

export const FILE_EXTENSION = '.mvm'

// A vendor media type rather than `application/json`, so a picker and a file
// association can name this format specifically. Every place that writes
// bytes, filters a picker, or registers the app as a handler takes it from
// here: a manifest that drifted from the picker would register the app for
// files it does not write.
export const MVM_MEDIA_TYPE = 'application/x-mvm+json'
