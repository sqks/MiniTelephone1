<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { MessageCircle, UserPlus, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import AvatarView from '@/components/AvatarView.vue'
import ProfileDrawer from '@/components/ProfileDrawer.vue'
import FriendsList from '@/components/FriendsList.vue'
import ConversationsList from '@/components/ConversationsList.vue'
import AddFriendSheet from '@/components/AddFriendSheet.vue'
import AdminEntry from '@/components/AdminEntry.vue'
import ChatWindow from '@/components/ChatWindow.vue'
import EntriesView from '@/components/EntriesView.vue'

const props = defineProps({
  me: { type: Object, required: true },
  onMeChange: { type: Function, required: true },
  onLogout: { type: Function, required: true },
})

const tab = ref('chat')
const drawerOpen = ref(false)
const friends = ref([])
const conversations = ref([])
const addOpen = ref(false)
const chatWith = ref(null)
const entriesOpen = ref(false)
const pendingIncoming = ref(0)

function refreshFriends() {
  api.listFriends().then((l) => (friends.value = l)).catch((e) => toast.error(e.message))
}

function refreshConversations() {
  api.listConversations().then((l) => (conversations.value = l)).catch(() => {})
}

function refreshRequests() {
  api
    .listFriendRequests()
    .then((d) => (pendingIncoming.value = d.incoming.length))
    .catch(() => {})
}

let timer = null
onMounted(() => {
  refreshFriends()
  refreshConversations()
  refreshRequests()
  timer = setInterval(() => {
    refreshConversations()
    refreshRequests()
  }, 5000)
})
onUnmounted(() => clearInterval(timer))

const unreadTotal = computed(() => conversations.value.reduce((sum, c) => sum + (c.unread_count || 0), 0))

// 左滑手势：从屏幕左边缘向右滑打开个人页；抽屉打开时向左滑关闭
const gesture = ref(null)
const overlayOpen = computed(() => addOpen.value || !!chatWith.value || entriesOpen.value)

const onTouchStart = (e) => {
  if (overlayOpen.value) return
  const t = e.touches[0]
  gesture.value = { x: t.clientX, y: t.clientY }
}

const onTouchEnd = (e) => {
  const start = gesture.value
  gesture.value = null
  if (!start || overlayOpen.value) return
  const t = e.changedTouches[0]
  const dx = t.clientX - start.x
  const dy = t.clientY - start.y
  if (!drawerOpen.value && start.x <= 36 && dx > 64 && Math.abs(dy) < 90) {
    drawerOpen.value = true
  } else if (drawerOpen.value && dx < -56 && Math.abs(dy) < 90) {
    drawerOpen.value = false
  }
}
</script>

<template>
  <div
    class="mx-auto flex h-full w-full max-w-3xl flex-col bg-[#f2f4f7] md:border-x md:border-gray-200"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <header class="safe-top flex items-center gap-3 bg-emerald-600 px-4 pb-3 text-white">
      <button @click="drawerOpen = true" class="active:scale-95 transition" aria-label="打开个人页">
        <AvatarView :name="me.name" :url="me.avatar_url" :size="38" ring />
      </button>
      <div class="min-w-0 flex-1">
        <h1 class="text-lg font-semibold leading-tight">MiniTelephone</h1>
        <p class="truncate text-xs text-emerald-100">
          {{ me.name }} · UID {{ me.uid }}
        </p>
      </div>
      <AdminEntry class="text-emerald-100 hover:text-white active:bg-white/10" />
      <button
        @click="addOpen = true"
        aria-label="添加好友"
        class="relative rounded-full p-2 active:bg-white/10"
      >
        <UserPlus class="h-6 w-6" />
        <span
          v-if="pendingIncoming > 0"
          class="absolute right-0 top-0 min-w-[18px] rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-medium leading-none text-white"
        >
          {{ pendingIncoming > 99 ? '99+' : pendingIncoming }}
        </span>
      </button>
    </header>

    <main class="flex-1 overflow-y-auto">
      <ConversationsList v-if="tab === 'chat'" :conversations="conversations" :on-chat="(c) => (chatWith = c)" />
      <FriendsList v-else :friends="friends" :on-chat="(friend) => (chatWith = { type: 'dm', peer: friend })" />
    </main>

    <nav class="safe-bottom grid grid-cols-2 border-t border-gray-200 bg-white">
      <button
        @click="tab = 'chat'"
        :class="`relative flex flex-col items-center gap-0.5 py-2 transition ${
          tab === 'chat' ? 'text-emerald-600' : 'text-gray-400'
        }`"
      >
        <MessageCircle class="h-6 w-6" />
        <span class="text-xs">聊天</span>
        <span
          v-if="unreadTotal > 0"
          class="absolute right-[24%] top-1 min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-medium leading-none bg-red-500 text-white"
        >
          {{ unreadTotal > 99 ? '99+' : unreadTotal }}
        </span>
      </button>
      <button
        @click="tab = 'friends'"
        :class="`relative flex flex-col items-center gap-0.5 py-2 transition ${
          tab === 'friends' ? 'text-emerald-600' : 'text-gray-400'
        }`"
      >
        <Users class="h-6 w-6" />
        <span class="text-xs">好友</span>
        <span
          v-if="friends.length > 0"
          class="absolute right-[24%] top-1 min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-medium leading-none bg-emerald-100 text-emerald-700"
        >
          {{ friends.length > 99 ? '99+' : friends.length }}
        </span>
      </button>
    </nav>

    <ProfileDrawer
      :open="drawerOpen"
      :me="me"
      :on-close="() => (drawerOpen = false)"
      :on-me-change="onMeChange"
      :on-open-entries="
        () => {
          drawerOpen = false
          entriesOpen = true
        }
      "
      :on-logout="onLogout"
    />

    <AddFriendSheet
      v-if="addOpen"
      :on-close="() => (addOpen = false)"
      :on-changed="
        () => {
          refreshFriends()
          refreshConversations()
          refreshRequests()
        }
      "
    />

    <ChatWindow
      v-if="chatWith"
      :me="me"
      :friend="chatWith.type === 'dm' ? chatWith.peer : null"
      :group="chatWith.type === 'group' ? chatWith.group : null"
      :on-close="
        () => {
          chatWith = null
          refreshConversations()
        }
      "
      :on-removed="
        () => {
          chatWith = null
          refreshFriends()
          refreshConversations()
        }
      "
    />

    <EntriesView v-if="entriesOpen" :on-close="() => (entriesOpen = false)" />
  </div>
</template>
