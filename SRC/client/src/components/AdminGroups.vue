<script setup>
import { onMounted, ref } from 'vue'
import { Trash2, UserPlus, UsersRound, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/time'
import AvatarView from './AvatarView.vue'

// 管理面板 · 群组管理：勾选用户建群、加人 / 踢人 / 删群
const props = defineProps({
  users: { type: Array, required: true },
})

const groups = ref(null)
const name = ref('')
const selected = ref([]) // uid 数组
const memberDrafts = ref({}) // groupId -> uid 输入
const busy = ref(false)

function load() {
  api.adminListGroups().then((g) => (groups.value = g)).catch((e) => toast.error(e.message))
}

onMounted(() => {
  load()
})

function toggle(uid) {
  selected.value = selected.value.includes(uid)
    ? selected.value.filter((u) => u !== uid)
    : [...selected.value, uid]
}

async function create(e) {
  e.preventDefault()
  if (selected.value.length < 2) return toast.error('至少勾选 2 位用户才能建群')
  busy.value = true
  try {
    const g = await api.adminCreateGroup({ name: name.value.trim(), uids: selected.value })
    toast.success(`已创建群组「${g.name}」（${g.member_count} 人）`)
    name.value = ''
    selected.value = []
    load()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function removeGroup(g) {
  if (!window.confirm(`解散群组「${g.name}」？群内聊天记录将一并删除。`)) return
  try {
    await api.adminDeleteGroup(g.id)
    toast.success('群组已解散')
    load()
  } catch (err) {
    toast.error(err.message)
  }
}

async function addMember(g) {
  const uid = Number((memberDrafts.value[g.id] || '').trim())
  if (!uid) return toast.error('请输入要拉入的用户 UID')
  try {
    await api.adminAddGroupMember(g.id, uid)
    toast.success('已拉入群组')
    memberDrafts.value = { ...memberDrafts.value, [g.id]: '' }
    load()
  } catch (err) {
    toast.error(err.message)
  }
}

async function removeMember(g, u) {
  if (!window.confirm(`把「${u.name}」移出群组「${g.name}」？`)) return
  try {
    await api.adminRemoveGroupMember(g.id, u.uid)
    toast.success('已移出')
    load()
  } catch (err) {
    toast.error(err.message)
  }
}

function onMemberDraftInput(g, e) {
  memberDrafts.value = { ...memberDrafts.value, [g.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }
}
</script>

<template>
  <div class="mt-4 space-y-4">
    <form @submit="create" class="rounded-2xl bg-white p-4 shadow-sm">
      <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <UsersRound class="h-4 w-4 text-emerald-600" />
        创建群组（勾选至少 2 位用户）
      </p>
      <input
        v-model="name"
        placeholder="群名（留空自动用成员名字）"
        maxlength="30"
        class="mt-3 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
      />
      <div class="mt-3 max-h-56 space-y-1 overflow-y-auto">
        <p v-if="users.length === 0" class="py-4 text-center text-xs text-gray-400">
          还没有注册用户，先到「用户管理」创建
        </p>
        <label
          v-for="u in users"
          v-else
          :key="u.uid"
          :class="`flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 transition ${
            selected.includes(u.uid) ? 'border-emerald-500 bg-emerald-50' : 'border-gray-100 active:bg-gray-50'
          }`"
        >
          <input
            type="checkbox"
            :checked="selected.includes(u.uid)"
            @change="toggle(u.uid)"
            class="h-4 w-4 accent-emerald-600"
          />
          <AvatarView :name="u.name" :url="u.avatar_url" :size="30" />
          <span class="min-w-0 flex-1 truncate text-sm text-gray-800">{{ u.name }}</span>
          <span class="font-mono text-xs text-gray-400">{{ u.uid }}</span>
        </label>
      </div>
      <button
        type="submit"
        :disabled="busy || selected.length < 2"
        class="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
      >
        {{ busy ? '创建中…' : `创建群组${selected.length ? `（已选 ${selected.length} 人）` : ''}` }}
      </button>
    </form>

    <p v-if="groups === null" class="rounded-2xl bg-white px-4 py-8 text-center text-sm text-gray-400 shadow-sm">
      读取中…
    </p>
    <p v-else-if="groups.length === 0" class="rounded-2xl bg-white px-4 py-8 text-center text-sm text-gray-400 shadow-sm">
      还没有群组
    </p>
    <div v-for="g in groups" v-else :key="g.id" class="rounded-2xl bg-white p-4 shadow-sm">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-gray-900">{{ g.name }}</p>
          <p class="mt-0.5 text-xs text-gray-400">
            {{ g.member_count }} 名成员 · {{ formatTime(g.created_at) }} 创建
          </p>
        </div>
        <button
          @click="removeGroup(g)"
          class="flex shrink-0 items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 active:bg-red-100"
        >
          <Trash2 class="h-3.5 w-3.5" />
          解散
        </button>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        <span
          v-for="u in g.members"
          :key="u.uid"
          class="flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-1 pr-1.5 text-xs text-gray-700"
        >
          <AvatarView :name="u.name" :url="u.avatar_url" :size="20" />
          {{ u.name }}
          <button
            @click="removeMember(g, u)"
            :aria-label="`移出 ${u.name}`"
            class="rounded-full p-0.5 text-gray-400 active:bg-gray-200 active:text-red-500"
          >
            <X class="h-3 w-3" />
          </button>
        </span>
      </div>

      <div class="mt-3 flex gap-2">
        <input
          :value="memberDrafts[g.id] || ''"
          @input="onMemberDraftInput(g, $event)"
          inputmode="numeric"
          placeholder="输入 UID 拉人入群"
          class="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500"
        />
        <button
          @click="addMember(g)"
          class="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white active:bg-emerald-700"
        >
          <UserPlus class="h-3.5 w-3.5" />
          拉入
        </button>
      </div>
    </div>
  </div>
</template>
