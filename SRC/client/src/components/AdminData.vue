<script setup>
import { computed, onMounted, ref } from 'vue'
import { Database, Download, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'

function fmtBytes(n) {
  if (n === null || n === undefined) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// 管理面板 · 数据：存储监控 / 导出全部数据 / 删除管理
const storage = ref(null)
const exporting = ref(false)
const busy = ref(false)

function load() {
  api.adminGetStorage().then((s) => (storage.value = s)).catch((e) => toast.error(e.message))
}

onMounted(() => {
  load()
})

async function exportAll() {
  exporting.value = true
  try {
    const { blob, filename } = await api.adminExportData()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${filename}（${fmtBytes(blob.size)}）`)
  } catch (e) {
    toast.error(e.message)
  } finally {
    exporting.value = false
  }
}

async function clearMessages() {
  if (!window.confirm('清空全部聊天记录？将删除所有私聊与群聊的文字、图片、语音消息（保留用户、群组和头像）。')) return
  busy.value = true
  try {
    await api.adminClearMessages()
    toast.success('聊天记录已清空')
    load()
  } catch (e) {
    toast.error(e.message)
  } finally {
    busy.value = false
  }
}

async function clearAll() {
  if (!window.confirm('重置服务器？将删除全部用户、群组、聊天记录与文件，不可恢复！')) return
  if (window.prompt('请输入 RESET 确认重置') !== 'RESET') return toast.error('已取消')
  busy.value = true
  try {
    await api.adminClearAll()
    toast.success('服务器已重置（保留管理密钥与集成配置）')
    load()
  } catch (e) {
    toast.error(e.message)
  } finally {
    busy.value = false
  }
}

const diskPct = computed(() =>
  storage.value?.disk && storage.value.disk.total > 0
    ? Math.round(((storage.value.disk.total - storage.value.disk.free) / storage.value.disk.total) * 100)
    : null,
)
</script>

<template>
  <div class="mt-4 space-y-4">
    <div class="rounded-2xl bg-white p-4 shadow-sm">
      <div class="flex items-center justify-between">
        <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <HardDrive class="h-4 w-4 text-emerald-600" />
          存储监控
        </p>
        <button @click="load" class="p-1.5 text-gray-400 active:text-emerald-600" aria-label="刷新">
          <RefreshCw class="h-4 w-4" />
        </button>
      </div>
      <p v-if="storage === null" class="mt-3 text-xs text-gray-400">读取中…</p>
      <template v-else>
        <div class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl bg-gray-50 p-3">
            <p class="text-base font-bold text-gray-900">{{ fmtBytes(storage.total_bytes) }}</p>
            <p class="mt-0.5 text-[10px] text-gray-400">数据总占用</p>
          </div>
          <div class="rounded-xl bg-gray-50 p-3">
            <p class="text-base font-bold text-gray-900">{{ fmtBytes(storage.messages_files.bytes) }}</p>
            <p class="mt-0.5 text-[10px] text-gray-400">聊天文件 {{ storage.messages_files.files }} 个</p>
          </div>
          <div class="rounded-xl bg-gray-50 p-3">
            <p class="text-base font-bold text-gray-900">{{ fmtBytes(storage.db_bytes) }}</p>
            <p class="mt-0.5 text-[10px] text-gray-400">数据库</p>
          </div>
        </div>
        <div class="mt-2 space-y-1 text-xs text-gray-500">
          <p>头像文件：{{ fmtBytes(storage.avatars.bytes) }}（{{ storage.avatars.files }} 个）</p>
          <p>
            用户 {{ storage.counts.users }} · 私聊消息 {{ storage.counts.dm_messages }} · 群消息
            {{ storage.counts.group_messages }} · 群组 {{ storage.counts.groups }} · 待审批
            {{ storage.counts.pending_requests }}
          </p>
        </div>
        <div v-if="storage.disk" class="mt-3">
          <div class="flex justify-between text-[10px] text-gray-400">
            <span>服务器磁盘</span>
            <span>
              可用 {{ fmtBytes(storage.disk.free) }} / 共 {{ fmtBytes(storage.disk.total) }}
            </span>
          </div>
          <div class="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              :class="`h-full rounded-full ${diskPct > 90 ? 'bg-red-500' : diskPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`"
              :style="{ width: `${diskPct}%` }"
            />
          </div>
        </div>
      </template>
    </div>

    <div class="rounded-2xl bg-white p-4 shadow-sm">
      <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Download class="h-4 w-4 text-emerald-600" />
        导出全部数据
      </p>
      <p class="mt-1 text-xs leading-relaxed text-gray-400">
        打包下载 zip：SQLite 数据库（用户、好友、群组、全部文字消息）+ resource
        目录（所有头像、聊天图片、语音文件），可用于备份或迁移。
      </p>
      <button
        @click="exportAll"
        :disabled="exporting"
        class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
      >
        <Loader2 v-if="exporting" class="h-4 w-4 animate-spin" />
        <Database v-else class="h-4 w-4" />
        {{ exporting ? '打包中…' : '导出并下载' }}
      </button>
    </div>

    <div class="rounded-2xl bg-white p-4 shadow-sm">
      <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Trash2 class="h-4 w-4 text-red-500" />
        删除管理
      </p>
      <p class="mt-1 text-xs leading-relaxed text-gray-400">
        删除用户请到「用户」tab，解散群组请到「群组」tab。以下是批量清理操作，执行前建议先导出备份。
      </p>
      <button
        @click="clearMessages"
        :disabled="busy"
        class="mt-3 w-full rounded-xl bg-amber-50 py-2.5 text-sm font-medium text-amber-700 active:bg-amber-100 disabled:opacity-50"
      >
        清空全部聊天记录（保留用户与头像）
      </button>
      <button
        @click="clearAll"
        :disabled="busy"
        class="mt-2 w-full rounded-xl bg-red-50 py-2.5 text-sm font-medium text-red-600 active:bg-red-100 disabled:opacity-50"
      >
        重置服务器（删除全部用户与数据）
      </button>
    </div>
  </div>
</template>
