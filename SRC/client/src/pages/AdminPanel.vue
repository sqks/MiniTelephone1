<script setup>
import { onMounted, ref } from 'vue'
import {
  Check,
  ChevronLeft,
  ClipboardList,
  Database,
  KeyRound,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
  UsersRound,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api, loadAdminToken, setAdminToken } from '@/lib/api'
import { formatTime } from '@/lib/time'
import AvatarView from '@/components/AvatarView.vue'
import AdminIntegrations from '@/components/AdminIntegrations.vue'
import AdminGroups from '@/components/AdminGroups.vue'
import AdminData from '@/components/AdminData.vue'

const props = defineProps({
  onBack: { type: Function, required: true },
})

const authed = ref(false)
const checking = ref(true)
const tokenInput = ref('')
const overview = ref(null)
const tab = ref('requests')
const requests = ref([])
const users = ref([])
const uidDrafts = ref({})
const newUser = ref({ name: '', age: '', school: '', uid: '' })
const newToken = ref('')
const busy = ref(false)

const tabs = [
  ['requests', ClipboardList, '审批'],
  ['users', Users, '用户'],
  ['groups', UsersRound, '群组'],
  ['data', Database, '数据'],
  ['settings', Settings, '设置'],
]

async function refresh() {
  try {
    const [ov, reqs, us] = await Promise.all([
      api.adminOverview(),
      api.adminListRequests('pending'),
      api.adminListUsers(),
    ])
    overview.value = ov
    requests.value = reqs
    users.value = us
  } catch (e) {
    toast.error(e.message)
  }
}

onMounted(() => {
  const saved = loadAdminToken()
  if (!saved) {
    checking.value = false
    return
  }
  api
    .adminOverview()
    .then(() => {
      authed.value = true
      refresh()
    })
    .catch(() => setAdminToken(null))
    .finally(() => (checking.value = false))
})

async function handleAuth(e) {
  e.preventDefault()
  if (!tokenInput.value.trim()) return
  setAdminToken(tokenInput.value.trim())
  try {
    await api.adminOverview()
    authed.value = true
    refresh()
  } catch (err) {
    setAdminToken(null)
    toast.error(err.message)
  }
}

async function toggleMode() {
  if (!overview.value) return
  const next = overview.value.mode === 'open' ? 'closed' : 'open'
  try {
    await api.adminSetMode(next)
    overview.value = { ...overview.value, mode: next }
    toast.success(next === 'open' ? '已切换为开放注册模式' : '已切换为未开放模式')
  } catch (e) {
    toast.error(e.message)
  }
}

async function approve(req) {
  const uid = (uidDrafts.value[req.id] || '').trim()
  if (uid) {
    const n = Number(uid)
    if (!Number.isInteger(n) || n < 1 || n > 999999) {
      toast.error('UID 必须是 6 位以内的数字')
      return
    }
  }
  try {
    const r = await api.adminApprove(req.id, uid || undefined)
    toast.success(`已批准「${req.name}」，UID：${r.uid}`)
    refresh()
  } catch (e) {
    toast.error(e.message)
  }
}

async function reject(req) {
  if (!window.confirm(`拒绝「${req.name}」的注册申请？`)) return
  try {
    await api.adminReject(req.id)
    toast.success('已拒绝该申请')
    refresh()
  } catch (e) {
    toast.error(e.message)
  }
}

async function createUser(e) {
  e.preventDefault()
  const name = newUser.value.name.trim()
  if (!name) return toast.error('请填写姓名')
  const age = newUser.value.age.trim() ? Number(newUser.value.age) : undefined
  if (age !== undefined && (!Number.isInteger(age) || age < 1 || age > 150)) {
    return toast.error('年龄必须是 1～150 的整数')
  }
  const uid = newUser.value.uid.trim() ? Number(newUser.value.uid) : undefined
  if (uid !== undefined && (!Number.isInteger(uid) || uid < 1 || uid > 999999)) {
    return toast.error('UID 必须是 6 位以内的数字')
  }
  busy.value = true
  try {
    const u = await api.adminCreateUser({ name, age, school: newUser.value.school.trim(), uid })
    toast.success(`已创建用户「${u.name}」，UID：${u.uid}`)
    newUser.value = { name: '', age: '', school: '', uid: '' }
    refresh()
  } catch (err) {
    toast.error(err.message)
  } finally {
    busy.value = false
  }
}

async function deleteUser(u) {
  if (!window.confirm(`删除用户「${u.name}」（UID ${u.uid}）？其信息、头像与好友关系将一并删除。`)) return
  try {
    await api.adminDeleteUser(u.uid)
    toast.success('已删除该用户')
    refresh()
  } catch (e) {
    toast.error(e.message)
  }
}

async function changeToken(e) {
  e.preventDefault()
  if (newToken.value.trim().length < 4) return toast.error('新密钥至少 4 个字符')
  try {
    await api.adminChangeToken(newToken.value.trim())
    setAdminToken(newToken.value.trim())
    newToken.value = ''
    toast.success('管理密钥已更新')
  } catch (err) {
    toast.error(err.message)
  }
}

function onUidDraftInput(req, e) {
  uidDrafts.value = { ...uidDrafts.value, [req.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }
}

function onNewUserAgeInput(e) {
  newUser.value.age = e.target.value.replace(/\D/g, '').slice(0, 3)
}

function onNewUserUidInput(e) {
  newUser.value.uid = e.target.value.replace(/\D/g, '').slice(0, 6)
}
</script>

<template>
  <div v-if="checking" class="flex h-full items-center justify-center bg-[#f2f4f7]">
    <div class="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
  </div>

  <div v-else-if="!authed" class="h-full overflow-y-auto bg-[#f2f4f7]">
    <div class="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-4 py-10">
      <div class="rounded-2xl bg-white p-6 shadow-sm">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600">
          <ShieldCheck class="h-7 w-7 text-white" />
        </div>
        <h1 class="mt-3 text-center text-lg font-bold text-gray-900">管理面板</h1>
        <p class="mt-1 text-center text-xs text-gray-400">请输入管理密钥</p>
        <form @submit="handleAuth" class="mt-4 space-y-3">
          <input
            type="password"
            v-model="tokenInput"
            placeholder="管理密钥"
            class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            class="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700"
          >
            进入管理面板
          </button>
        </form>
      </div>
      <button @click="onBack" class="mx-auto mt-6 text-xs text-gray-400 underline underline-offset-2">
        返回
      </button>
    </div>
  </div>

  <div v-else class="h-full overflow-y-auto bg-[#f2f4f7]">
    <div class="mx-auto w-full max-w-4xl px-4 pb-10">
      <header class="sticky top-0 z-10 -mx-4 flex items-center gap-1 bg-[#f2f4f7]/95 px-4 py-4 backdrop-blur">
        <button @click="onBack" class="p-1.5 text-gray-600" aria-label="返回">
          <ChevronLeft class="h-6 w-6" />
        </button>
        <h1 class="flex-1 text-lg font-bold text-gray-900">管理面板</h1>
        <button @click="refresh" class="p-1.5 text-gray-500 active:text-emerald-600" aria-label="刷新">
          <RefreshCw class="h-5 w-5" />
        </button>
      </header>

      <div v-if="overview" class="grid grid-cols-3 gap-3">
        <div class="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p class="text-2xl font-bold text-gray-900">{{ overview.user_count }}</p>
          <p class="mt-0.5 text-xs text-gray-400">注册用户</p>
        </div>
        <div class="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p class="text-2xl font-bold text-amber-500">{{ overview.pending_count }}</p>
          <p class="mt-0.5 text-xs text-gray-400">待审批</p>
        </div>
        <button @click="toggleMode" class="rounded-2xl bg-white p-4 text-center shadow-sm active:bg-gray-50">
          <p :class="`text-base font-bold ${overview.mode === 'open' ? 'text-emerald-600' : 'text-gray-500'}`">
            {{ overview.mode === 'open' ? '开放注册' : '未开放' }}
          </p>
          <p class="mt-0.5 text-xs text-gray-400">点击切换模式</p>
        </button>
      </div>

      <div class="mt-4 grid grid-cols-5 gap-1 rounded-xl bg-gray-200/70 p-1 text-sm">
        <button
          v-for="[key, Icon, label] in tabs"
          :key="key"
          @click="tab = key"
          :class="`flex items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition ${
            tab === key ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
          }`"
        >
          <component :is="Icon" class="h-4 w-4" />
          {{ label }}
        </button>
      </div>

      <div v-if="tab === 'requests'" class="mt-4 space-y-3">
        <p
          v-if="requests.length === 0"
          class="rounded-2xl bg-white px-4 py-10 text-center text-sm text-gray-400 shadow-sm"
        >
          暂无待审批的注册申请
        </p>
        <div v-for="req in requests" v-else :key="req.id" class="rounded-2xl bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-gray-900">{{ req.name }}</p>
            <span class="text-xs text-gray-400">{{ formatTime(req.created_at) }}</span>
          </div>
          <p class="mt-1 text-xs text-gray-500">
            {{ req.age }} 岁 · {{ req.school }}
          </p>
          <div class="mt-3 flex gap-2">
            <input
              :value="uidDrafts[req.id] || ''"
              @input="onUidDraftInput(req, $event)"
              inputmode="numeric"
              placeholder="指定 UID（留空自动分配）"
              class="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500"
            />
            <button
              @click="approve(req)"
              class="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white active:bg-emerald-700"
            >
              <Check class="h-3.5 w-3.5" />
              批准
            </button>
            <button
              @click="reject(req)"
              class="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 active:bg-red-100"
            >
              <X class="h-3.5 w-3.5" />
              拒绝
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="tab === 'users'" class="mt-4 space-y-4">
        <form @submit="createUser" class="rounded-2xl bg-white p-4 shadow-sm">
          <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <UserPlus class="h-4 w-4 text-emerald-600" />
            创建用户（未开放模式下使用）
          </p>
          <div class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <input
              v-model="newUser.name"
              placeholder="姓名 *"
              maxlength="30"
              class="rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <input
              :value="newUser.age"
              @input="onNewUserAgeInput"
              inputmode="numeric"
              placeholder="年龄"
              class="rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <input
              v-model="newUser.school"
              placeholder="学校"
              maxlength="60"
              class="rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <input
              :value="newUser.uid"
              @input="onNewUserUidInput"
              inputmode="numeric"
              placeholder="UID（留空自动）"
              class="rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            :disabled="busy"
            class="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {{ busy ? '创建中…' : '创建用户' }}
          </button>
        </form>

        <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
          <p v-if="users.length === 0" class="px-4 py-10 text-center text-sm text-gray-400">还没有注册用户</p>
          <ul v-else class="divide-y divide-gray-100">
            <li v-for="u in users" :key="u.uid" class="flex items-center gap-3 px-4 py-3">
              <AvatarView :name="u.name" :url="u.avatar_url" :size="40" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-900">{{ u.name }}</p>
                <p class="truncate text-xs text-gray-400">
                  {{ u.age ? `${u.age} 岁 · ` : '' }}
                  {{ u.school || '未填写学校' }} · {{ formatTime(u.created_at) }} 注册
                </p>
              </div>
              <span class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-700">
                {{ u.uid }}
              </span>
              <button
                @click="deleteUser(u)"
                class="shrink-0 p-1.5 text-gray-300 active:text-red-500"
                aria-label="删除用户"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </li>
          </ul>
        </div>
      </div>

      <AdminGroups v-else-if="tab === 'groups'" :users="users" />

      <AdminData v-else-if="tab === 'data'" />

      <template v-else-if="tab === 'settings'">
        <AdminIntegrations />
        <form @submit="changeToken" class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <KeyRound class="h-4 w-4 text-emerald-600" />
            修改管理密钥
          </p>
          <input
            type="password"
            v-model="newToken"
            placeholder="新密钥（至少 4 个字符）"
            class="mt-3 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            class="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700"
          >
            保存新密钥
          </button>
          <p class="mt-3 text-xs text-gray-400">
            初始密钥为 admin123，建议尽快修改。数据保存在服务器 SQLite 中，修改后立即生效。
          </p>
        </form>
      </template>
    </div>
  </div>
</template>
