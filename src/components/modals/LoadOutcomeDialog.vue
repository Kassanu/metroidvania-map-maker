<script setup lang="ts">
// What a load that did not simply succeed tells the user.
//
// Two shapes behind one component, because they are the same moment: either
// the file loaded with repairs and needs accepting, or it did not load and
// needs explaining. Splitting them would put the same overlay, sizing and
// dismissal logic in two files.
//
// A repaired load reports counts by kind. A damaged file produces thousands of
// events, and a scrollable wall of them informs nobody; `countByKind` is what
// the loader was built to hand over.

import { computed } from 'vue'
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { t } from '@/i18n'
import type { MessageKey } from '@/i18n'
import type { LoadEventKind } from '@/core/serialize'
import type { LimitName } from '@/core/serialize/limits'
import type { LoadOutcome } from '@/stores/file'

const props = defineProps<{ outcome: LoadOutcome | null }>()
const emit = defineEmits<{ accept: []; dismiss: []; forget: [] }>()

// One message per repair kind. A `Record` rather than a lookup with a
// fallback, so a kind added to the loader is a type error here rather than a
// blank row in the dialog.
const REPAIR_LABELS: Record<LoadEventKind, MessageKey> = {
  'cell-dropped': 'load.cellDropped',
  'inner-wall-dropped': 'load.innerWallDropped',
  'room-dropped': 'load.roomDropped',
  'room-split': 'load.roomSplit',
  'icon-dropped': 'load.iconDropped',
  'line-dropped': 'load.lineDropped',
  'transition-dropped': 'load.transitionDropped',
  'door-trimmed': 'load.doorTrimmed',
  'area-remapped': 'load.areaRemapped',
  'lock-remapped': 'load.lockRemapped',
  'setting-reset': 'load.settingReset',
  'color-reset': 'load.colorReset',
  'icon-type-reset': 'load.iconTypeReset',
  'assumed-default': 'load.assumedDefault',
  'id-remapped': 'load.idRemapped',
  'text-truncated': 'load.textTruncated',
}

// What each cap is, said in words a person can act on. A `Record` for the
// same reason as the repairs above: a limit added to the table is a type error
// here rather than a sentence naming a code identifier.
const LIMIT_LABELS: Record<LimitName, MessageKey> = {
  bytes: 'load.limit.bytes',
  maps: 'load.limit.maps',
  areas: 'load.limit.areas',
  lockTypes: 'load.limit.lockTypes',
  roomsPerMap: 'load.limit.roomsPerMap',
  cellsPerRoom: 'load.limit.cellsPerRoom',
  cellsPerProject: 'load.limit.cellsPerProject',
  innerWallsPerRoom: 'load.limit.innerWallsPerRoom',
  transitionsPerMap: 'load.limit.transitionsPerMap',
  segmentsPerDoor: 'load.limit.segmentsPerDoor',
  iconsPerMap: 'load.limit.iconsPerMap',
  linesPerMap: 'load.limit.linesPerMap',
  pointsPerLine: 'load.limit.pointsPerLine',
  coordinate: 'load.limit.coordinate',
  nameLength: 'load.limit.nameLength',
  notesLength: 'load.limit.notesLength',
  glyphLength: 'load.limit.glyphLength',
}

const isRepair = computed(() => props.outcome?.kind === 'repaired')

// The two failures that name a file the app already knew about. They are the
// only ones with something to do besides closing: drop the entry that led
// here, since an entry that no longer opens is worth nothing to anyone.
const canForget = computed(
  () => props.outcome?.kind === 'missing' || props.outcome?.kind === 'permission-refused',
)

const repairs = computed(() => {
  if (props.outcome?.kind !== 'repaired') return []
  return [...props.outcome.counts.entries()].map(([kind, count]) =>
    t(REPAIR_LABELS[kind], { count }),
  )
})

const failure = computed(() => {
  switch (props.outcome?.kind) {
    case 'invalid':
      return t('load.invalid')
    case 'too-large':
      return t('load.tooLarge', {
        found: props.outcome.found.toLocaleString(),
        allowed: props.outcome.allowed.toLocaleString(),
        what: t(LIMIT_LABELS[props.outcome.limit]),
      })
    case 'too-new':
      return t('load.tooNew', {
        version: props.outcome.version,
        supported: props.outcome.supported,
      })
    case 'missing':
      return t('load.missing', { name: props.outcome.name })
    case 'permission-refused':
      return t('load.permissionRefused', { name: props.outcome.name })
    case 'failed':
      return t('load.error', { message: props.outcome.message })
    default:
      return ''
  }
})

// Neither button closes the dialog: Reka's Action and Cancel do, and the close
// fires before the button's own handler, so the dismissal arrived first and
// cleared the outcome that `accept` was about to read. Accepting a repaired
// file then did nothing at all. Escape and the overlay are what reach this.
function onOpenChange(open: boolean) {
  if (!open) emit('dismiss')
}
</script>

<template>
  <AlertDialogRoot :open="outcome !== null" @update:open="onOpenChange">
    <AlertDialogPortal>
      <AlertDialogOverlay class="modal-overlay" />
      <AlertDialogContent class="modal-content" style="--modal-width: 24rem">
        <AlertDialogTitle class="outcome-title">
          {{ isRepair ? t('load.repaired.title') : t('load.failed.title') }}
        </AlertDialogTitle>
        <AlertDialogDescription class="outcome-body">
          {{ isRepair ? t('load.repaired.body') : failure }}
        </AlertDialogDescription>
        <ul v-if="isRepair" class="outcome-repairs">
          <li v-for="line in repairs" :key="line">{{ line }}</li>
        </ul>
        <div class="outcome-actions">
          <button type="button" class="outcome-cancel" @click="emit('dismiss')">
            {{ isRepair ? t('common.cancel') : t('common.close') }}
          </button>
          <button v-if="isRepair" type="button" class="outcome-accept" @click="emit('accept')">
            {{ t('load.repaired.accept') }}
          </button>
          <button v-if="canForget" type="button" class="outcome-accept" @click="emit('forget')">
            {{ t('load.forget') }}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.outcome-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.outcome-body {
  font-size: 0.875rem;
  opacity: 0.8;
  margin: 0 0 0.75rem;
}

/* Bounded, because a badly damaged file can trip a dozen different kinds at
   once and the actions must stay reachable without scrolling the page. */
.outcome-repairs {
  margin: 0 0 1rem;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  max-height: 12rem;
  overflow-y: auto;
}

.outcome-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.outcome-cancel,
.outcome-accept {
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.outcome-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
}
.outcome-cancel:hover {
  background: var(--surface-active);
}

.outcome-accept {
  border: none;
  background: var(--accent);
  color: #fff;
}
.outcome-accept:hover {
  filter: brightness(1.1);
}
</style>
