<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { Toaster } from 'vue-sonner'
import { api, loadStoredUid, setCurrentUid } from '@/lib/api'
import AuthPage from '@/pages/AuthPage.vue'
import AdminPanel from '@/pages/AdminPanel.vue'
import MainShell from '@/pages/MainShell.vue'

const view = ref('loading') // loading | auth | admin | main
const me = ref(null)

onMounted(() => {
  const uid = loadStoredUid()
  if (!uid) {
    view.value = 'auth'
    return
  }
  api
    .getMe()
    .then((user) => {
      me.value = user
      view.value = 'main'
    })
    .catch(() => {
      setCurrentUid(null)
      view.value = 'auth'
    })
})

// 管理面板入口隐藏：仅通过在地址栏加 #admin 进入（API 仍有管理密钥验证）
const checkHash = () => {
  if (window.location.hash === '#admin') view.value = 'admin'
}
onMounted(() => {
  checkHash()
  window.addEventListener('hashchange', checkHash)
})
onUnmounted(() => {
  window.removeEventListener('hashchange', checkHash)
})

function handleLogin(user) {
  setCurrentUid(user.uid)
  me.value = user
  view.value = 'main'
}

function handleLogout() {
  setCurrentUid(null)
  me.value = null
  view.value = 'auth'
}

function closeAdmin() {
  history.replaceState(null, '', window.location.pathname + window.location.search)
  view.value = me.value ? 'main' : 'auth'
}

function handleMeChange(user) {
  me.value = user
}
</script>

<template>
  <div v-if="view === 'loading'" class="flex h-full items-center justify-center bg-[#f2f4f7]">
    <div class="text-center">
      <div class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      <p class="mt-3 text-sm text-gray-500">加载中…</p>
    </div>
  </div>
  <div v-else class="h-full bg-[#dde2e8]">
    <AuthPage v-if="view === 'auth'" :on-login="handleLogin" />
    <AdminPanel v-else-if="view === 'admin'" :on-back="closeAdmin" />
    <MainShell
      v-else-if="view === 'main' && me"
      :me="me"
      :on-me-change="handleMeChange"
      :on-logout="handleLogout"
    />
    <Toaster position="top-center" richColors />
  </div>
</template>
