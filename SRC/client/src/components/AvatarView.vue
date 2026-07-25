<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  name: { type: String, default: null },
  url: { type: String, default: null },
  size: { type: Number, default: 40 },
  ring: { type: Boolean, default: false },
})

const broken = ref(false)
const letter = computed(() => (props.name ?? '未命名').trim().charAt(0).toUpperCase() || '?')
const ringCls = computed(() => (props.ring ? 'ring-2 ring-white/70' : ''))
</script>

<template>
  <img
    v-if="url && !broken"
    :src="url"
    :alt="name ?? '头像'"
    @error="broken = true"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :class="`shrink-0 rounded-full object-cover ${ringCls}`"
  />
  <div
    v-else
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` }"
    :class="`flex shrink-0 items-center justify-center rounded-full bg-emerald-200 font-semibold text-emerald-800 ${ringCls}`"
  >
    {{ letter }}
  </div>
</template>
