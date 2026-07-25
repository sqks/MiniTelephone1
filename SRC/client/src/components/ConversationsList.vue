<script setup>
import { MessageCircle, UsersRound } from 'lucide-vue-next'
import { formatTime } from '@/lib/time'
import AvatarView from './AvatarView.vue'

function previewText(m) {
  if (!m) return ''
  if (m.kind === 'image') return '[图片]'
  if (m.kind === 'audio') return `[语音]${m.duration ? ` ${Math.round(m.duration)}″` : ''}`
  return m.content
}

defineProps({
  conversations: { type: Array, required: true },
  onChat: { type: Function, required: true },
})
</script>

<template>
  <div v-if="conversations.length === 0" class="flex h-full flex-col items-center justify-center pb-16 text-center">
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
      <MessageCircle class="h-9 w-9 text-emerald-500" />
    </div>
    <p class="mt-4 text-sm text-gray-500">暂无聊天</p>
    <p class="mt-1 text-xs text-gray-400">到「好友」页选择一位好友开始吧</p>
  </div>

  <ul v-else class="divide-y divide-gray-100 bg-white">
    <li v-for="c in conversations" :key="c.type === 'group' ? `g${c.group.id}` : `u${c.peer.uid}`">
      <button
        @click="onChat(c)"
        class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
      >
        <span
          v-if="c.type === 'group'"
          class="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-emerald-100"
        >
          <UsersRound class="h-6 w-6 text-emerald-600" />
        </span>
        <AvatarView v-else :name="c.peer.name" :url="c.peer.avatar_url" :size="46" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900">
            {{ c.type === 'group' ? c.group.name : c.peer.name }}
            <span v-if="c.type === 'group'" class="ml-1 text-xs font-normal text-gray-400">
              （{{ c.group.member_count }} 人）
            </span>
          </p>
          <p class="truncate text-xs text-gray-400">
            {{
              (c.type === 'group' && c.last_message?.sender
                ? `${c.last_message.sender.name}：${previewText(c.last_message)}`
                : previewText(c.last_message)) || '还没有消息'
            }}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-[10px] text-gray-300">{{ formatTime(c.last_message?.created_at) }}</p>
          <span
            v-if="c.unread_count > 0"
            class="mt-1 inline-block min-w-[18px] rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-medium leading-none text-white"
          >
            {{ c.unread_count > 99 ? '99+' : c.unread_count }}
          </span>
        </div>
      </button>
    </li>
  </ul>
</template>
