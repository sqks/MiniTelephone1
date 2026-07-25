<script setup>
import { ref } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'

const props = defineProps({
  mode: { type: String, required: true },
  entry: { type: Object, default: undefined },
  tagSuggestions: { type: Array, required: true },
  onClose: { type: Function, required: true },
  onSaved: { type: Function, required: true },
  onDeleted: { type: Function, required: true },
})

const items = ref(
  props.entry ? props.entry.items.map((i) => ({ tag: i.tag, content: i.content })) : [{ tag: '', content: '' }],
)
const saving = ref(false)

function updateItem(idx, patch) {
  items.value = items.value.map((it, i) => (i === idx ? { ...it, ...patch } : it))
}

function removeItem(idx) {
  if (items.value.length > 1) items.value = items.value.filter((_, i) => i !== idx)
}

async function save() {
  const payload = items.value
    .map((i) => ({ tag: i.tag.trim(), content: i.content }))
    .filter((i) => i.tag.length > 0 || i.content.trim().length > 0)
  if (payload.length === 0) {
    toast.error('至少填写一项标签内容')
    return
  }
  if (payload.some((i) => !i.tag)) {
    toast.error('标签名不能为空')
    return
  }
  saving.value = true
  try {
    if (props.mode === 'create') await api.createEntry(payload)
    else await api.updateEntry(props.entry.id, payload)
    toast.success('已保存')
    props.onSaved()
  } catch (e) {
    toast.error(e.message)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.entry || !window.confirm('确定删除这条信息？')) return
  try {
    await api.deleteEntry(props.entry.id)
    toast.success('已删除')
    props.onDeleted()
  } catch (e) {
    toast.error(e.message)
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-[#f2f4f7]">
    <div class="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header class="safe-top flex items-center justify-between bg-emerald-600 px-2 pb-3 text-white">
        <button @click="onClose" class="p-2" aria-label="取消">
          <X class="h-6 w-6" />
        </button>
        <h2 class="text-base font-semibold">{{ mode === 'create' ? '新增信息' : '编辑信息' }}</h2>
        <button
          @click="save"
          :disabled="saving"
          class="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium active:bg-white/25 disabled:opacity-50"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </header>

      <main class="safe-bottom flex-1 overflow-y-auto px-4 pt-4">
        <datalist id="tag-suggestions">
          <option v-for="t in tagSuggestions" :key="t" :value="t" />
        </datalist>

        <div class="space-y-3">
          <div v-for="(item, idx) in items" :key="idx" class="rounded-2xl bg-white p-3 shadow-sm">
            <div class="flex items-center gap-2">
              <input
                :value="item.tag"
                @input="updateItem(idx, { tag: $event.target.value })"
                list="tag-suggestions"
                placeholder="标签（如：手机号）"
                maxlength="30"
                class="w-36 shrink-0 rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <div class="flex-1" />
              <button
                v-if="items.length > 1"
                @click="removeItem(idx)"
                class="p-1.5 text-gray-400 active:text-red-500"
                aria-label="删除这一项"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
            <textarea
              :value="item.content"
              @input="updateItem(idx, { content: $event.target.value })"
              placeholder="标签内容…"
              rows="2"
              class="mt-2 w-full resize-none rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <button
          @click="items = [...items, { tag: '', content: '' }]"
          class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 py-3 text-sm font-medium text-emerald-700 active:bg-emerald-50"
        >
          <Plus class="h-4 w-4" />
          添加标签
        </button>

        <button
          v-if="mode === 'edit'"
          @click="remove"
          class="mt-6 w-full rounded-2xl bg-red-50 py-3 text-sm font-medium text-red-600 active:bg-red-100"
        >
          删除这条信息
        </button>
      </main>
    </div>
  </div>
</template>
