<script setup>
import { ref, watch } from 'vue'
import { Camera, Check, ChevronRight, Copy, IdCard, LogOut, Pencil, Trash2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/time'
import AvatarView from './AvatarView.vue'
import AdminIntegrations from './AdminIntegrations.vue'

const props = defineProps({
  open: { type: Boolean, required: true },
  me: { type: Object, default: null },
  onClose: { type: Function, required: true },
  onMeChange: { type: Function, required: true },
  onOpenEntries: { type: Function, required: true },
  onLogout: { type: Function, required: true },
})

const avatars = ref([])
const editingName = ref(false)
const nameDraft = ref('')
const uploading = ref(false)
const fileRef = ref(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    editingName.value = false
    api.listAvatars().then((l) => (avatars.value = l)).catch((e) => toast.error(e.message))
  },
)

async function handleFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    await api.uploadAvatar(file)
    const [user, list] = await Promise.all([api.getMe(), api.listAvatars()])
    props.onMeChange(user)
    avatars.value = list
    toast.success('头像已更新')
  } catch (err) {
    toast.error(err.message)
  } finally {
    uploading.value = false
  }
}

async function saveName() {
  const name = nameDraft.value.trim()
  editingName.value = false
  if (!name || name === props.me?.name) return
  try {
    props.onMeChange(await api.updateMe({ name, age: props.me.age, school: props.me.school }))
    toast.success('名字已保存')
  } catch (err) {
    toast.error(err.message)
  }
}

async function useAvatar(av) {
  if (av.current) return
  try {
    props.onMeChange(await api.useAvatar(av.id))
    avatars.value = await api.listAvatars()
    toast.success('已切换为这张头像')
  } catch (err) {
    toast.error(err.message)
  }
}

async function removeAvatar(av) {
  if (!window.confirm('删除这张历史头像？')) return
  try {
    props.onMeChange(await api.deleteAvatar(av.id))
    avatars.value = await api.listAvatars()
    toast.success('已删除')
  } catch (err) {
    toast.error(err.message)
  }
}

function copyUid() {
  if (!props.me) return
  navigator.clipboard?.writeText(String(props.me.uid)).then(
    () => toast.success('UID 已复制，发给同学加好友吧'),
    () => toast.error('复制失败'),
  )
}

function startEditName() {
  nameDraft.value = props.me?.name ?? ''
  editingName.value = true
}

// autoFocus 等价物：元素插入时自动聚焦
const vFocus = {
  mounted: (el) => el.focus(),
}
</script>

<template>
  <div :class="`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`">
    <div
      @click="onClose"
      :class="`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
        open ? 'opacity-100' : 'opacity-0'
      }`"
    />
    <aside
      :class="`absolute left-0 top-0 flex h-full w-[84%] max-w-[340px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`"
    >
      <div class="safe-top bg-emerald-600 px-5 pb-6 text-white">
        <button
          @click="fileRef?.click()"
          :disabled="uploading"
          class="relative block active:scale-95 transition"
          aria-label="更换头像"
        >
          <AvatarView :name="me?.name" :url="me?.avatar_url" :size="72" ring />
          <span class="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-white text-emerald-600 shadow">
            <Camera class="h-4 w-4" />
          </span>
        </button>
        <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="handleFile" />

        <div class="mt-3 flex h-8 items-center gap-2">
          <template v-if="editingName">
            <input
              v-model="nameDraft"
              v-focus
              @keydown="(e) => e.key === 'Enter' && saveName()"
              @blur="saveName"
              maxlength="30"
              class="w-40 rounded-md bg-white/15 px-2 py-1 text-lg font-semibold text-white outline-none placeholder-white/50"
              placeholder="输入名字"
            />
            <button @click="saveName" aria-label="保存名字" class="p-1">
              <Check class="h-5 w-5" />
            </button>
            <button @click="editingName = false" aria-label="取消" class="p-1">
              <X class="h-5 w-5 text-emerald-100" />
            </button>
          </template>
          <template v-else>
            <span class="text-xl font-semibold">{{ me?.name ?? '未命名' }}</span>
            <button
              @click="startEditName"
              aria-label="编辑名字"
              class="p-1"
            >
              <Pencil class="h-4 w-4 text-emerald-100" />
            </button>
          </template>
        </div>

        <button
          @click="copyUid"
          class="mt-1.5 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs text-emerald-50 active:bg-white/25"
        >
          <IdCard class="h-3.5 w-3.5" />
          UID：{{ me?.uid }}
          <Copy class="h-3 w-3" />
        </button>
        <p v-if="me?.school" class="mt-1.5 text-xs text-emerald-100">{{ me.school }}</p>
        <p v-if="uploading" class="mt-1 text-xs text-emerald-100">头像上传中…</p>
      </div>

      <div class="flex-1 overflow-y-auto">
        <button
          @click="onOpenEntries"
          class="flex w-full items-center justify-between border-b border-gray-100 px-5 py-3.5 text-sm font-medium text-gray-800 active:bg-gray-50"
        >
          我的信息
          <ChevronRight class="h-4 w-4 text-gray-400" />
        </button>

        <div class="px-4">
          <AdminIntegrations card-class="border border-gray-100 bg-gray-50" />
        </div>

        <div class="p-4">
          <h3 class="text-sm font-semibold text-gray-700">历史头像</h3>
          <p v-if="avatars.length === 0" class="mt-3 text-xs text-gray-400">还没有头像记录，点头像上传一张吧</p>
          <div v-else class="mt-3 grid grid-cols-3 gap-3">
            <div v-for="av in avatars" :key="av.id" class="relative">
              <button
                @click="useAvatar(av)"
                :class="`block w-full overflow-hidden rounded-xl border-2 transition ${
                  av.current ? 'border-emerald-500' : 'border-transparent active:scale-95'
                }`"
                aria-label="使用这张头像"
              >
                <img :src="av.url" alt="历史头像" loading="lazy" class="aspect-square w-full object-cover" />
              </button>
              <span
                v-if="av.current"
                class="pointer-events-none absolute left-1 top-1 rounded bg-emerald-500 px-1 py-0.5 text-[10px] leading-none text-white"
              >
                使用中
              </span>
              <button
                @click="removeAvatar(av)"
                aria-label="删除这张头像"
                class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white"
              >
                <Trash2 class="h-3 w-3" />
              </button>
              <p class="mt-1 text-center text-[10px] text-gray-400">{{ formatTime(av.created_at) }}</p>
            </div>
          </div>
        </div>
      </div>

      <footer class="safe-bottom border-t border-gray-100 px-4">
        <button
          @click="() => { if (window.confirm('退出当前账号？')) onLogout() }"
          class="flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2.5 text-sm font-medium text-red-600 active:bg-red-100"
        >
          <LogOut class="h-4 w-4" />
          退出登录
        </button>
        <p class="mt-2 text-center text-xs text-gray-400">
          注册于 {{ me ? formatTime(me.created_at) : '-' }}
        </p>
      </footer>
    </aside>
  </div>
</template>

