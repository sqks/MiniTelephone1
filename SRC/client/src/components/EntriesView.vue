<script setup>
import { onMounted, ref } from 'vue'
import { ChevronLeft, MessageSquarePlus, Plus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/time'
import EntryEditor from './EntryEditor.vue'

const props = defineProps({
  onClose: { type: Function, required: true },
})

const entries = ref([])
const tags = ref([])
const editor = ref(null) // { mode: 'create' } | { mode: 'edit', entry }

function refresh() {
  Promise.all([api.listEntries(), api.listTags()])
    .then(([list, tagList]) => {
      entries.value = list
      tags.value = tagList
    })
    .catch((e) => toast.error(e.message))
}

onMounted(() => {
  refresh()
})
</script>

<template>
  <div class="fixed inset-0 z-50 bg-[#f2f4f7]">
    <div class="relative mx-auto flex h-full w-full max-w-3xl flex-col">
      <header class="safe-top flex items-center gap-1 bg-emerald-600 px-2 pb-3 text-white">
        <button @click="onClose" class="p-2" aria-label="返回">
          <ChevronLeft class="h-6 w-6" />
        </button>
        <h2 class="text-base font-semibold">我的信息</h2>
      </header>

      <main class="flex-1 overflow-y-auto px-3 pt-3">
        <div v-if="entries.length === 0" class="flex h-full flex-col items-center justify-center pb-20 text-center">
          <div class="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
            <MessageSquarePlus class="h-9 w-9 text-emerald-500" />
          </div>
          <p class="mt-4 text-sm text-gray-500">还没有信息</p>
          <p class="mt-1 text-xs text-gray-400">点击右下角 + 新增第一条信息</p>
        </div>
        <ul v-else class="space-y-3 pb-28">
          <li v-for="entry in entries" :key="entry.id">
            <button
              @click="editor = { mode: 'edit', entry }"
              class="block w-full rounded-2xl bg-white p-4 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div class="space-y-2">
                <div v-for="(item, i) in entry.items" :key="i" class="flex items-start gap-2">
                  <span class="mt-0.5 shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    {{ item.tag }}
                  </span>
                  <span class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                    {{ item.content || '—' }}
                  </span>
                </div>
              </div>
              <p class="mt-3 text-right text-xs text-gray-400">
                更新于 {{ formatTime(entry.updated_at) }}
              </p>
            </button>
          </li>
        </ul>
      </main>

      <button
        @click="editor = { mode: 'create' }"
        aria-label="新增信息"
        class="absolute right-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 active:scale-95 transition"
        :style="{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }"
      >
        <Plus class="h-7 w-7" />
      </button>

      <EntryEditor
        v-if="editor"
        :mode="editor.mode"
        :entry="editor.mode === 'edit' ? editor.entry : undefined"
        :tag-suggestions="tags"
        :on-close="() => (editor = null)"
        :on-saved="
          () => {
            editor = null
            refresh()
          }
        "
        :on-deleted="
          () => {
            editor = null
            refresh()
          }
        "
      />
    </div>
  </div>
</template>
