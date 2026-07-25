<script setup>
import { onMounted, ref, watch } from 'vue'
import { CheckCircle2, Copy, Loader2, PhoneCall, XCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import AdminEntry from '@/components/AdminEntry.vue'

const props = defineProps({
  onLogin: { type: Function, required: true },
})

const mode = ref(null)
const tab = ref('login')
const uidInput = ref('')
const form = ref({ name: '', age: '', school: '' })
const busy = ref(false)
const reg = ref(null) // { id, status: 'pending' | 'approved' | 'rejected', uid }

onMounted(() => {
  api
    .getMode()
    .then((m) => (mode.value = m.mode))
    .catch(() => (mode.value = 'open'))
  const saved = Number(localStorage.getItem('mt_reg_id'))
  if (saved) {
    api
      .registerStatus(saved)
      .then((s) => {
        if (s.status === 'pending') reg.value = { id: saved, status: 'pending', uid: null }
        else localStorage.removeItem('mt_reg_id')
      })
      .catch(() => localStorage.removeItem('mt_reg_id'))
  }
})

// 轮询审批状态，通过/拒绝后自动更新
watch(
  reg,
  (val, _old, onCleanup) => {
    if (!val || val.status !== 'pending') return
    const timer = setInterval(() => {
      api
        .registerStatus(val.id)
        .then((s) => {
          if (s.status !== 'pending') {
            reg.value = { id: val.id, status: s.status, uid: s.uid }
            localStorage.removeItem('mt_reg_id')
          }
        })
        .catch(() => {})
    }, 4000)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true },
)

async function handleLogin(e) {
  e.preventDefault()
  const uid = Number(uidInput.value.trim())
  if (!Number.isInteger(uid) || uid < 1 || uid > 999999) {
    toast.error('请输入 6 位以内的 UID')
    return
  }
  busy.value = true
  try {
    props.onLogin(await api.loginWithUid(uid))
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function handleRegister(e) {
  e.preventDefault()
  const name = form.value.name.trim()
  const school = form.value.school.trim()
  const age = Number(form.value.age)
  if (!name) return toast.error('请填写姓名')
  if (!Number.isInteger(age) || age < 1 || age > 150) return toast.error('请填写正确的年龄')
  if (!school) return toast.error('请填写学校')
  busy.value = true
  try {
    const r = await api.register({ name, age, school })
    localStorage.setItem('mt_reg_id', String(r.request_id))
    reg.value = { id: r.request_id, status: 'pending', uid: null }
    toast.success('申请已提交，等待管理员审批')
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function enter(uid) {
  busy.value = true
  try {
    props.onLogin(await api.loginWithUid(uid))
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

function copyUid(uid) {
  navigator.clipboard?.writeText(String(uid)).then(
    () => toast.success('UID 已复制'),
    () => toast.error('复制失败'),
  )
}

function resetReg() {
  localStorage.removeItem('mt_reg_id')
  reg.value = null
}

function onUidInput(e) {
  uidInput.value = e.target.value.replace(/\D/g, '').slice(0, 6)
}

function onAgeInput(e) {
  form.value.age = e.target.value.replace(/\D/g, '').slice(0, 3)
}
</script>

<template>
  <div class="relative h-full overflow-y-auto bg-[#f2f4f7]">
    <!-- 管理面板入口：仅 PC 端右上角显示，手机隐藏 -->
    <AdminEntry class="absolute right-3 top-3 z-10 text-gray-300 hover:text-emerald-600" />
    <div class="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-4 py-10">
      <div class="mb-6 text-center">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-600 shadow-lg shadow-emerald-600/30">
          <PhoneCall class="h-8 w-8 text-white" />
        </div>
        <h1 class="mt-3 text-2xl font-bold text-gray-900">MiniTelephone</h1>
        <p class="mt-1 text-sm text-gray-400">小电话 · 和同学保持联系</p>
      </div>

      <div v-if="reg?.status === 'pending'" class="rounded-2xl bg-white p-6 text-center shadow-sm">
        <Loader2 class="mx-auto h-10 w-10 animate-spin text-emerald-500" />
        <h2 class="mt-3 text-base font-semibold text-gray-900">申请已提交</h2>
        <p class="mt-1 text-sm text-gray-500">
          正在等待管理员审批，通过后会自动显示你的 UID，请稍候…
        </p>
        <button
          @click="resetReg"
          class="mt-4 text-xs text-gray-400 underline underline-offset-2"
        >
          取消等待，返回登录
        </button>
      </div>

      <div v-else-if="reg?.status === 'approved'" class="rounded-2xl bg-white p-6 text-center shadow-sm">
        <CheckCircle2 class="mx-auto h-10 w-10 text-emerald-500" />
        <h2 class="mt-3 text-base font-semibold text-gray-900">注册已通过</h2>
        <p class="mt-1 text-sm text-gray-500">这是你的 UID，加好友时会用到：</p>
        <button
          @click="copyUid(reg.uid)"
          class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 py-3 text-2xl font-bold tracking-widest text-emerald-700 active:bg-emerald-100"
        >
          {{ reg.uid }}
          <Copy class="h-4 w-4" />
        </button>
        <button
          @click="enter(reg.uid)"
          :disabled="busy"
          class="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
        >
          进入 MiniTelephone
        </button>
      </div>

      <div v-else-if="reg?.status === 'rejected'" class="rounded-2xl bg-white p-6 text-center shadow-sm">
        <XCircle class="mx-auto h-10 w-10 text-red-400" />
        <h2 class="mt-3 text-base font-semibold text-gray-900">申请未通过</h2>
        <p class="mt-1 text-sm text-gray-500">管理员拒绝了你的注册申请，如有疑问请联系管理员。</p>
        <button
          @click="resetReg"
          class="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white active:bg-emerald-700"
        >
          重新申请
        </button>
      </div>

      <div v-else class="rounded-2xl bg-white p-5 shadow-sm">
        <div class="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          <button
            @click="tab = 'login'"
            :class="`rounded-lg py-2 font-medium transition ${
              tab === 'login' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
            }`"
          >
            UID 登录
          </button>
          <button
            @click="tab = 'register'"
            :class="`rounded-lg py-2 font-medium transition ${
              tab === 'register' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
            }`"
          >
            注册申请
          </button>
        </div>

        <form v-if="tab === 'login'" @submit="handleLogin" class="space-y-3">
          <input
            :value="uidInput"
            @input="onUidInput"
            inputmode="numeric"
            placeholder="输入你的 UID（6 位以内）"
            class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            :disabled="busy"
            class="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {{ busy ? '登录中…' : '进入 MiniTelephone' }}
          </button>
        </form>
        <div v-else-if="mode === 'closed'" class="rounded-xl bg-amber-50 px-4 py-5 text-center">
          <p class="text-sm font-medium text-amber-700">当前为未开放模式</p>
          <p class="mt-1 text-xs text-amber-600/80">
            服务器暂未开放注册，请联系管理员创建账号并获取 UID
          </p>
        </div>
        <form v-else @submit="handleRegister" class="space-y-3">
          <input
            v-model="form.name"
            placeholder="姓名"
            maxlength="30"
            class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <input
            :value="form.age"
            @input="onAgeInput"
            inputmode="numeric"
            placeholder="年龄"
            class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <input
            v-model="form.school"
            placeholder="学校"
            maxlength="60"
            class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            :disabled="busy"
            class="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {{ busy ? '提交中…' : '提交申请' }}
          </button>
          <p class="text-center text-xs text-gray-400">提交后由管理员审批，通过即分配 UID</p>
        </form>
      </div>
    </div>
  </div>
</template>
