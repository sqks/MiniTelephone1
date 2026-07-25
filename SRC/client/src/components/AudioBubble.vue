<script setup>
import { ref } from 'vue'
import { Play, Square } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps({
  src: { type: String, required: true },
  duration: { type: Number, default: null },
})

const audioRef = ref(null)
const playing = ref(false)

function toggle() {
  const a = audioRef.value
  if (!a) return
  if (playing.value) {
    a.pause()
    a.currentTime = 0
    playing.value = false
  } else {
    a.play().then(() => (playing.value = true)).catch(() => toast.error('播放失败'))
  }
}
</script>

<template>
  <span class="flex items-center gap-2">
    <button
      type="button"
      @click="toggle"
      :aria-label="playing ? '停止播放' : '播放语音'"
      class="flex h-7 w-7 items-center justify-center rounded-full bg-black/10"
    >
      <Square v-if="playing" class="h-3.5 w-3.5" />
      <Play v-else class="h-3.5 w-3.5" />
    </button>
    <span class="text-sm">{{ duration ? `${Math.round(duration)}″` : '语音消息' }}</span>
    <audio ref="audioRef" :src="src" preload="none" @ended="playing = false" class="hidden" />
  </span>
</template>
