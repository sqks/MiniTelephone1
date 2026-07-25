<script setup>
import { ShieldCheck } from 'lucide-vue-next'
import { isDesktop } from '@/lib/platform'

// 管理面板入口按钮：仅 PC 端显示（手机 UA 一律隐藏），点击经 #admin 哈希进入。
// 后端所有 /api/admin/* 接口仍有管理密钥校验，此处只是导航入口。
defineOptions({ inheritAttrs: true })

const desktop = isDesktop()

function open() {
  window.location.hash = 'admin'
}
</script>

<template>
  <button
    v-if="desktop"
    @click="open"
    aria-label="管理面板"
    title="管理面板"
    class="rounded-full p-2 transition active:scale-95"
  >
    <ShieldCheck class="h-5 w-5" />
  </button>
</template>
