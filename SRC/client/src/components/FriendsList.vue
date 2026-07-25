<script setup>
import { Users } from 'lucide-vue-next'
import { formatTime } from '@/lib/time'
import AvatarView from './AvatarView.vue'

defineProps({
  friends: { type: Array, required: true },
  onChat: { type: Function, required: true },
})
</script>

<template>
  <div v-if="friends.length === 0" class="flex h-full flex-col items-center justify-center pb-16 text-center">
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
      <Users class="h-9 w-9 text-emerald-500" />
    </div>
    <p class="mt-4 text-sm text-gray-500">还没有好友</p>
    <p class="mt-1 text-xs text-gray-400">点右上角 + 通过 UID 添加好友</p>
  </div>

  <ul v-else class="divide-y divide-gray-100 bg-white">
    <li v-for="f in friends" :key="f.uid">
      <button
        @click="onChat(f)"
        class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
      >
        <AvatarView :name="f.name" :url="f.avatar_url" :size="46" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900">{{ f.name }}</p>
          <p class="truncate text-xs text-gray-400">
            UID {{ f.uid }}
            {{ f.school ? ` · ${f.school}` : '' }}
          </p>
        </div>
        <span class="shrink-0 text-[10px] text-gray-300">
          {{ formatTime(f.friend_since) }} 成为好友
        </span>
      </button>
    </li>
  </ul>
</template>
