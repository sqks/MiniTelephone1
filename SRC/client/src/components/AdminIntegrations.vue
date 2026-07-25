<script setup>
import { onMounted, ref } from 'vue'
import { KeyRound, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api, loadAdminToken, setAdminToken } from '@/lib/api'

// DeepSeek API Key 配置卡片。用于管理面板设置页和个人页抽屉。
// 接口需要管理密钥：本机没存过密钥时先要求输入一次，验证通过后记住。
defineProps({
  cardClass: { type: String, default: 'bg-white shadow-sm' },
})

const info = ref(null) // null = 读取中 / 未加载
const needAuth = ref(false)
const tokenDraft = ref('')
const keyInput = ref('')
const busy = ref(false)

async function load() {
  if (!loadAdminToken()) {
    needAuth.value = true
    info.value = null
    return
  }
  try {
    info.value = await api.adminGetIntegrations()
    needAuth.value = false
  } catch (e) {
    info.value = null
    if (e.message.includes('管理密钥')) {
      needAuth.value = true // 密钥失效，要求重新输入
    } else {
      toast.error(e.message)
    }
  }
}

onMounted(() => {
  load()
})

async function auth(e) {
  e.preventDefault()
  const token = tokenDraft.value.trim()
  if (!token) return
  setAdminToken(token)
  tokenDraft.value = ''
  try {
    info.value = await api.adminGetIntegrations()
    needAuth.value = false
    toast.success('管理密钥验证通过')
  } catch (err) {
    setAdminToken(null)
    toast.error(err.message)
  }
}

async function save(e) {
  e.preventDefault()
  const key = keyInput.value.trim()
  if (!key) return toast.error('请粘贴 DeepSeek API Key')
  busy.value = true
  try {
    await api.adminSetIntegration(key)
    keyInput.value = ''
    toast.success('DeepSeek API Key 已保存，翻译功能已启用')
    load()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function clear() {
  if (!window.confirm('清除 DeepSeek API Key？聊天翻译功能将不可用。')) return
  try {
    await api.adminSetIntegration('')
    toast.success('已清除 API Key')
    load()
  } catch (err) {
    toast.error(err.message)
  }
}
</script>

<template>
  <div :class="`mt-4 rounded-2xl p-4 ${cardClass}`">
    <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
      <Sparkles class="h-4 w-4 text-emerald-600" />
      DeepSeek 翻译
    </p>

    <form v-if="needAuth" @submit="auth" class="mt-3 space-y-2">
      <p class="text-xs text-gray-400">配置 API Key 需要管理密钥</p>
      <div class="flex gap-2">
        <input
          type="password"
          v-model="tokenDraft"
          placeholder="管理密钥"
          class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          class="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white active:bg-emerald-700"
        >
          验证
        </button>
      </div>
    </form>
    <template v-else>
      <p class="mt-1 text-xs text-gray-400">
        状态：
        {{
          info === null
            ? '读取中…'
            : info.deepseek_key_set
              ? `已配置 ${info.deepseek_key_masked ?? ''}`
              : '未配置 API Key，翻译功能不可用'
        }}
      </p>
      <form @submit="save" class="mt-3 space-y-2">
        <div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 focus-within:border-emerald-500">
          <KeyRound class="h-4 w-4 shrink-0 text-gray-300" />
          <input
            type="password"
            v-model="keyInput"
            placeholder="粘贴 DeepSeek API Key（sk-...）"
            class="min-w-0 flex-1 py-2 text-sm outline-none"
          />
        </div>
        <div class="flex gap-2">
          <button
            type="submit"
            :disabled="busy"
            class="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {{ busy ? '保存中…' : '保存 Key' }}
          </button>
          <button
            v-if="info?.deepseek_key_set"
            type="button"
            @click="clear"
            class="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 active:bg-red-100"
          >
            清除
          </button>
        </div>
      </form>
      <p class="mt-2 text-xs leading-relaxed text-gray-400">
        到 platform.deepseek.com 注册申请 API Key。用于聊天消息的中文 / English / Русский 互译，
        Key 只保存在服务器 SQLite 中，不会下发给客户端。
      </p>
    </template>
  </div>
</template>
