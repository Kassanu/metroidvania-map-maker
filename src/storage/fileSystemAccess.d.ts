// The parts of the File System Access API the TypeScript DOM lib does not
// declare. `FileSystemFileHandle` itself is standard and already typed; the
// pickers and the permission methods are not.
//
// Declared rather than cast at each call site so the shapes are stated once
// and a typo in an option name is still a compile error. Kept narrow on
// purpose: only the members this app calls.

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  multiple?: boolean
  id?: string
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  suggestedName?: string
  id?: string
}

declare function showOpenFilePicker(
  options?: OpenFilePickerOptions,
): Promise<FileSystemFileHandle[]>

declare function showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}
