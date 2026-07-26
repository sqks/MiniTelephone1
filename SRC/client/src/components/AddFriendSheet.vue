<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { Check, Clock, Search, Undo2, UserPlus, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import AvatarView from './AvatarView.vue'

const props = defineProps({
  onClose: { type: Function, required: true },
  // 好友关系发生变化（同意了请求）时通知父组件刷新好友/会话列表
  onChanged: { type: Function, required: true },
})

const uidInput = ref('')
const result = ref(null)
const busy = ref(false)
const incoming = ref([])
const outgoing = ref([])

async function refreshRequests(silent = true) {
  try {
    const data = await api.listFriendRequests()
    incoming.value = data.incoming
    outgoing.value = data.outgoing
  } catch (err) {
    if (!silent) toast.error(err.message)
  }
}

let timer = null
onMounted(() => {
  refreshRequests(false)
  timer = setInterval(refreshRequests, 5000)
})
onUnmounted(() => clearInterval(timer))

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

async function send() {
  if (!result.value) return
  busy.value = true
  try {
    const r = await api.addFriend(result.value.uid)
    if (r.auto_accepted) {
      toast.success(`对方也想加你，已直接成为好友`)
      result.value = { ...result.value, is_friend: true }
      props.onChanged()
    } else {
      toast.success('好友请求已发送，等待对方同意')
      result.value = { ...result.value, outgoing_pending: true }
    }
    refreshRequests()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function accept(requestId, name) {
  busy.value = true
  try {
    await api.acceptFriendRequest(requestId)
    toast.success(`已同意，你和「${name}」现在是好友了`)
    if (result.value?.incoming_pending?.request_id === requestId) {
      result.value = { ...result.value, is_friend: true, incoming_pending: null }
    }
    await refreshRequests()
    props.onChanged()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function reject(requestId, name) {
  busy.value = true
  try {
    await api.rejectFriendRequest(requestId)
    toast.success(`已拒绝「${name}」的好友请求`)
    if (result.value?.incoming_pending?.request_id === requestId) {
      result.value = { ...result.value, incoming_pending: null }
    }
    await refreshRequests()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function cancel(requestId) {
  busy.value = true
  try {
    await api.cancelFriendRequest(requestId)
    toast.success('已撤回好友请求')
    if (result.value?.outgoing_pending) {
      result.value = { ...result.value, outgoing_pending: false }
    }
    await refreshRequests()
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
          <p v-else-if="result.outgoing_pending" class="mt-3 flex items-center justify-center gap-1.5 text-sm text-gray-400">
            <Clock class="h-4 w-4" />
            请求已发送，等待对方同意
          </p>
          <button
            v-else-if="result.incoming_pending"
            @click="accept(result.incoming_pending.request_id, result.name)"
            :disabled="busy"
            class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            <Check class="h-4 w-4" />
            对方想加你，点击同意
          </button>
          <button
            v-else
            @click="send"
            :disabled="busy"
            class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            <UserPlus class="h-4 w-4" />
            发送好友请求
          </button>
        </div>

        <!-- 收到的好友请求：审批同意 / 拒绝 -->
        <section v-if="incoming.length > 0" class="mt-6">
          <h3 class="mb-2 px-1 text-xs font-medium text-gray-500">收到的请求（{{ incoming.length }}）</h3>
          <div class="space-y-2">
            <div
              v-for="r in incoming"
              :key="r.request_id"
              class="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
            >
              <AvatarView :name="r.user.name" :url="r.user.avatar_url" :size="44" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-gray-900">{{ r.user.name }}</p>
                <p class="truncate text-xs text-gray-400">UID {{ r.user.uid }} 请求加你为好友</p>
              </div>
              <button
                @click="accept(r.request_id, r.user.name)"
                :disabled="busy"
                class="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
              >
                <Check class="h-3.5 w-3.5" />
                同意
              </button>
              <button
                @click="reject(r.request_id, r.user.name)"
                :disabled="busy"
                class="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 active:bg-gray-200 disabled:opacity-50"
              >
                <X class="h-3.5 w-3.5" />
                拒绝
              </button>
            </div>
          </div>
        </section>

        <!-- 我发出的请求：等待处理，可撤回 -->
        <section v-if="outgoing.length > 0" class="mt-6">
          <h3 class="mb-2 px-1 text-xs font-medium text-gray-500">我发出的请求（{{ outgoing.length }}）</h3>
          <div class="space-y-2">
            <div
              v-for="r in outgoing"
              :key="r.request_id"
              class="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
            >
              <AvatarView :name="r.user.name" :url="r.user.avatar_url" :size="44" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-gray-900">{{ r.user.name }}</p>
                <p class="flex items-center gap-1 truncate text-xs text-gray-400">
                  <Clock class="h-3 w-3" />
                  UID {{ r.user.uid }} · 等待对方同意
                </p>
              </div>
              <button
                @click="cancel(r.request_id)"
                :disabled="busy"
                class="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 active:bg-gray-200 disabled:opacity-50"
              >
                <Undo2 class="h-3.5 w-3.5" />
                撤回
              </button>
            </div>
          </div>
        </section>

        <p class="mt-6 text-center text-xs text-gray-400">
          发送请求后需对方在这里同意，双方成为好友才能私信；你的 UID 在个人页（左滑打开）可以复制
        </p>
      </main>
    </div>
  </div>
</template>
