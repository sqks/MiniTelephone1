<script setup>
import { ref } from 'vue'
import { Search, UserPlus, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import AvatarView from './AvatarView.vue'

const props = defineProps({
  onClose: { type: Function, required: true },
  onAdded: { type: Function, required: true },
})

const uidInput = ref('')
const result = ref(null)
const busy = ref(false)

async function lookup(e) {
  e?.preventDefault()
  const uid = Number(uidInput.value.trim())
  if (!Number.isInteger(uid) || uid < 1 || uid > 999999) {
    toast.error('请输入 6 位以内的 UID')
    return
  }
  busy.value = true
  result.value = null
  try {
    result.value = await api.lookupUser(uid)
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function add() {
  if (!result.value) return
  busy.value = true
  try {
    await api.addFriend(result.value.uid)
    toast.success(`已添加「${result.value.name}」为好友`)
    props.onAdded()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

function onUidInput(e) {
  uidInput.value = e.target.value.replace(/\D/g, '').slice(0, 6)
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-[#f2f4f7]">
    <div class="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header class="safe-top flex items-center justify-between bg-emerald-600 px-2 pb-3 text-white">
        <button @click="onClose" class="p-2" aria-label="关闭">
          <X class="h-6 w-6" />
        </button>
        <h2 class="text-base font-semibold">添加好友</h2>
        <span class="w-10" />
      </header>

      <main class="safe-bottom flex-1 overflow-y-auto p-4">
        <form @submit="lookup" class="flex gap-2">
          <input
            :value="uidInput"
            @input="onUidInput"
            inputmode="numeric"
            placeholder="输入对方 UID（6 位以内）"
            class="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            :disabled="busy"
            class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            <Search class="h-4 w-4" />
            查找
          </button>
        </form>

        <div v-if="result" class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div class="flex items-center gap-3">
            <AvatarView :name="result.name" :url="result.avatar_url" :size="52" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-base font-semibold text-gray-900">{{ result.name }}</p>
              <p class="truncate text-xs text-gray-400">
                UID {{ result.uid }}
                {{ result.age ? ` · ${result.age} 岁` : '' }}
                {{ result.school ? ` · ${result.school}` : '' }}
              </p>
            </div>
          </div>
          <p v-if="result.is_self" class="mt-3 text-center text-sm text-gray-400">这是你自己哦</p>
          <p v-else-if="result.is_friend" class="mt-3 text-center text-sm text-emerald-600">你们已经是好友了</p>
          <button
            v-else
            @click="add"
            :disabled="busy"
            class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            <UserPlus class="h-4 w-4" />
            添加好友
          </button>
        </div>

        <p class="mt-6 text-center text-xs text-gray-400">
          你的 UID 在个人页（左滑打开）可以复制，发给同学就能加你
        </p>
      </main>
    </div>
  </div>
</template>
