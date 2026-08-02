import { computed, ref } from 'vue'
import { searchIcons } from '@/icons/registry'

// The icon library as a surface reads it: a query and the entries matching it.
//
// Every surface goes through here rather than importing the registry array, so
// the day the catalogue stops being a static list (project-supplied icons are
// part of the file, not of the build) this is the only place that changes. The
// `computed` is already reactive, so a catalogue that grows at runtime would
// reach the grid without any surface knowing.
//
// Each caller gets its own query: the docked panel and the popup search
// independently, which is what makes them the same component rather than one
// component with shared state.
export function useIconCatalog() {
  const query = ref('')
  const results = computed(() => searchIcons(query.value))
  return { query, results }
}
