<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AudioLines,
  ChevronLeft,
  ImagePlus,
  Languages,
  Loader2,
  Mic,
  Send,
  Trash2,
  UsersRound,
  X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/time'
import AvatarView from './AvatarView.vue'
import AudioBubble from './AudioBubble.vue'

const props = defineProps({
  me: { type: Object, required: true },
  friend: { type: Object, default: null },
  group: { type: Object, default: null },
  onClose: { type: Function, required: true },
  onRemoved: { type: Function, required: true },
})

const isGroup = !!props.group
const targetId = isGroup ? props.group.id : props.friend.uid

// HTTPS 入口端口约定为 HTTP 端口 + 443（与服务端 / 启动器一致）
const httpsPort = location.port ? Number(location.port) + 443 : 3444
const httpsHint = `请改用 https:// 地址（端口 ${httpsPort}）访问`

const messages = ref([])
const draft = ref('')
const sending = ref(false)
const recording = ref(null) // { seconds }
const listening = ref(null) // { lang, active, seconds }
const translating = ref(null) // target code
const translations = ref({}) // msgId -> { status, text, target }
const preview = ref(null)
const listRef = ref(null)
const fileRef = ref(null)
const lastIdRef = ref(0)
const recorderRef = ref(null)
const speechRef = ref(null)

function scrollToBottom() {
  requestAnimationFrame(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function appendMessages(list) {
  if (!list.length) return
  lastIdRef.value = list[list.length - 1].id
  const ids = new Set(messages.value.map((m) => m.id))
  const added = list.filter((m) => !ids.has(m.id))
  if (added.length) messages.value = [...messages.value, ...added]
  scrollToBottom()
}

let pollCancelled = false
let pollTimer = null
async function poll(initial) {
  try {
    const list = isGroup
      ? await api.listGroupMessages(targetId, lastIdRef.value || undefined)
      : await api.listMessages(targetId, lastIdRef.value || undefined)
    if (!pollCancelled) {
      appendMessages(list)
      if (!isGroup) api.markRead(targetId).catch(() => {})
    }
  } catch (e) {
    if (initial && !pollCancelled) toast.error(e.message)
  }
}

onMounted(() => {
  poll(true)
  pollTimer = setInterval(() => poll(false), 2500)
})

onUnmounted(() => {
  pollCancelled = true
  clearInterval(pollTimer)
  if (recorderRef.value) {
    recorderRef.value.cancelled = true
    try {
      recorderRef.value.rec.stop()
    } catch {
      // already stopped
    }
  }
  if (speechRef.value) {
    const s = speechRef.value
    speechRef.value = null
    try {
      s.rec.stop()
    } catch {
      // already stopped
    }
  }
})

// 语音识别计时
watch(
  () => listening.value?.active,
  (active, _old, onCleanup) => {
    if (!active) return
    const timer = setInterval(() => {
      if (listening.value?.active) {
        listening.value = { ...listening.value, seconds: listening.value.seconds + 1 }
      }
    }, 1000)
    onCleanup(() => clearInterval(timer))
  },
)

async function sendText(e) {
  e?.preventDefault()
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true
  try {
    const m = isGroup ? await api.sendGroupText(targetId, content) : await api.sendText(targetId, content)
    draft.value = ''
    appendMessages([m])
  } catch (err) {
    toast.error(err.message)
  } finally {
    sending.value = false
  }
}

async function sendImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  sending.value = true
  try {
    appendMessages([await (isGroup ? api.sendGroupFile(targetId, file) : api.sendFile(targetId, file))])
  } catch (err) {
    toast.error(err.message)
  } finally {
    sending.value = false
  }
}

async function startRecording() {
  // 麦克风只在安全上下文（HTTPS / localhost）可用：局域网 http://IP 访问时
  // navigator.mediaDevices 会被浏览器整个隐藏，需区分这两种情况给出指引
  if (!window.isSecureContext) {
    toast.error(`当前是 http 访问，浏览器禁用了麦克风。${httpsHint}，首次点「高级 → 继续前往」`)
    return
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast.error('当前浏览器不支持录音，请用最新版 Chrome / Edge / Safari')
    return
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
      toast.error('麦克风权限被拒绝，请在浏览器地址栏左侧的站点设置中允许麦克风')
    } else if (err?.name === 'NotFoundError') {
      toast.error('未检测到麦克风设备')
    } else {
      toast.error('无法使用麦克风，请检查系统权限')
    }
    return
  }
  const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    const state = recorderRef.value
    recorderRef.value = null
    recording.value = null
    if (!state || state.cancelled) return
    const type = rec.mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type })
    if (blob.size === 0) return
    const seconds = Math.max(1, Math.round((Date.now() - state.startTs) / 1000))
    const ext = AUDIO_EXTS[type] || '.webm'
    sending.value = true
    try {
      appendMessages([
        await (isGroup
          ? api.sendGroupFile(targetId, new File([blob], `voice${ext}`, { type }), seconds)
          : api.sendFile(targetId, new File([blob], `voice${ext}`, { type }), seconds)),
      ])
    } catch (err) {
      toast.error(err.message)
    } finally {
      sending.value = false
    }
  }
  recorderRef.value = { rec, startTs: Date.now(), cancelled: false }
  rec.start()
  recording.value = { seconds: 0 }
  const timer = setInterval(() => {
    if (!recorderRef.value) {
      clearInterval(timer)
      return
    }
    recording.value = { seconds: Math.floor((Date.now() - recorderRef.value.startTs) / 1000) }
  }, 500)
}

function stopRecording(cancel) {
  const state = recorderRef.value
  if (!state) return
  state.cancelled = cancel
  try {
    state.rec.stop()
  } catch {
    // already stopped
  }
}

// ---------------- 语音转文字（Web Speech API） ----------------
function startListening(lang) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) {
    toast.error(
      window.isSecureContext
        ? '当前浏览器不支持语音识别，请用最新版 Chrome / Edge / Safari'
        : `语音识别需要 HTTPS 页面，${httpsHint}`,
    )
    return
  }
  if (speechRef.value) {
    const s = speechRef.value
    speechRef.value = null
    try {
      s.rec.stop()
    } catch {
      // already stopped
    }
  }
  const rec = new SR()
  rec.lang = lang
  rec.continuous = true
  rec.interimResults = true
  const base = draft.value.trim() ? `${draft.value.trim()} ` : ''
  const state = { rec, base, final: '' }
  speechRef.value = state
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i]
      if (r.isFinal) state.final += r[0].transcript
      else interim += r[0].transcript
    }
    draft.value = state.base + state.final + interim
  }
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast.error(
        window.isSecureContext
          ? '麦克风权限被拒绝，请在浏览器站点设置中允许麦克风'
          : `语音识别需要 HTTPS 页面，${httpsHint}`,
      )
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      toast.error(`语音识别失败：${e.error}`)
    }
    if (speechRef.value === state) speechRef.value = null
    if (listening.value) listening.value = { ...listening.value, active: false }
  }
  rec.onend = () => {
    if (speechRef.value === state) speechRef.value = null
    if (listening.value) listening.value = { ...listening.value, active: false }
  }
  try {
    rec.start()
    listening.value = { lang, active: true, seconds: 0 }
  } catch {
    toast.error('无法启动语音识别')
  }
}

function stopListening() {
  const s = speechRef.value
  speechRef.value = null
  if (s) {
    try {
      s.rec.stop()
    } catch {
      // already stopped
    }
  }
  listening.value = null
}

// ---------------- 翻译（DeepSeek） ----------------
async function translateMessage(m, target) {
  translations.value = { ...translations.value, [m.id]: { status: 'loading', target } }
  try {
    const r = await api.translate(m.content, target)
    translations.value = { ...translations.value, [m.id]: { status: 'done', text: r.translated, target } }
  } catch (e) {
    translations.value = { ...translations.value, [m.id]: { status: 'error', text: e.message, target } }
  }
}

async function translateDraft(target) {
  const text = draft.value.trim()
  if (!text || translating.value) return
  stopListening()
  translating.value = target
  try {
    const r = await api.translate(text, target)
    draft.value = r.translated
    toast.success('已翻译，可编辑后发送')
  } catch (e) {
    toast.error(e.message)
  } finally {
    translating.value = null
  }
}

async function removeFriend() {
  if (!window.confirm(`删除好友「${props.friend.name}」？之后将无法再聊天。`)) return
  try {
    await api.removeFriend(props.friend.uid)
    toast.success('已删除好友')
    props.onRemoved()
  } catch (e) {
    toast.error(e.message)
  }
}

function setTranslationStatus(id, status) {
  translations.value = { ...translations.value, [id]: { status } }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-[#f2f4f7]">
    <div class="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header class="safe-top flex items-center gap-1 bg-emerald-600 px-2 pb-3 text-white">
        <button @click="onClose" class="p-2" aria-label="返回">
          <ChevronLeft class="h-6 w-6" />
        </button>
        <span
          v-if="isGroup"
          class="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/20 ring-2 ring-white/40"
        >
          <UsersRound class="h-5 w-5 text-white" />
        </span>
        <AvatarView v-else :name="friend.name" :url="friend.avatar_url" :size="34" ring />
        <div class="min-w-0 flex-1 pl-1">
          <p class="truncate text-sm font-semibold">{{ isGroup ? group.name : friend.name }}</p>
          <p class="truncate text-xs text-emerald-100">
            {{ isGroup ? `${group.member_count ?? 0} 名成员` : `UID ${friend.uid}` }}
          </p>
        </div>
        <button v-if="!isGroup" @click="removeFriend" class="p-2" aria-label="删除好友">
          <Trash2 class="h-5 w-5 text-emerald-100" />
        </button>
      </header>

      <main ref="listRef" class="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <p v-if="messages.length === 0" class="pt-16 text-center text-xs text-gray-400">
          还没有聊天记录，发第一条消息吧
        </p>
        <div
          v-for="m in messages"
          :key="m.id"
          :class="`flex ${m.from_uid === me.uid ? 'justify-end' : 'justify-start'}`"
        >
          <div
            :class="`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
              m.from_uid === me.uid
                ? 'rounded-br-md bg-emerald-600 text-white'
                : 'rounded-bl-md bg-white text-gray-900'
            }`"
          >
            <p v-if="isGroup && m.from_uid !== me.uid" class="mb-0.5 text-[10px] font-medium text-emerald-600">
              {{ m.sender?.name ?? `UID ${m.from_uid}` }}
            </p>
            <template v-if="m.kind === 'text'">
              <div>
                <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{{ m.content }}</p>
                <div :class="`mt-1.5 border-t pt-1 ${m.from_uid === me.uid ? 'border-white/25' : 'border-gray-100'}`">
                  <button
                    v-if="!translations[m.id] || translations[m.id].status === 'idle'"
                    type="button"
                    @click="setTranslationStatus(m.id, 'menu')"
                    :class="`flex items-center gap-1 text-[10px] ${m.from_uid === me.uid ? 'text-emerald-100/80' : 'text-gray-400'}`"
                  >
                    <Languages class="h-3 w-3" />
                    翻译
                  </button>
                  <span v-else-if="translations[m.id].status === 'menu'" class="flex flex-wrap items-center gap-1.5">
                    <button
                      v-for="[code, label] in TRANS_LANGS"
                      :key="code"
                      type="button"
                      @click="translateMessage(m, code)"
                      :class="`rounded-full px-2 py-0.5 text-[10px] ${
                        m.from_uid === me.uid ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                      }`"
                    >
                      {{ label }}
                    </button>
                    <button
                      type="button"
                      @click="setTranslationStatus(m.id, 'idle')"
                      :class="`px-1 text-[10px] ${m.from_uid === me.uid ? 'text-emerald-100/80' : 'text-gray-400'}`"
                    >
                      收起
                    </button>
                  </span>
                  <p
                    v-else-if="translations[m.id].status === 'loading'"
                    :class="`flex items-center gap-1 text-[10px] ${m.from_uid === me.uid ? 'text-emerald-100/80' : 'text-gray-400'}`"
                  >
                    <Loader2 class="h-3 w-3 animate-spin" />
                    翻译中…
                  </p>
                  <button
                    v-else-if="translations[m.id].status === 'error'"
                    type="button"
                    @click="translateMessage(m, translations[m.id].target)"
                    :class="`text-left text-[10px] ${m.from_uid === me.uid ? 'text-red-200' : 'text-red-400'}`"
                  >
                    {{ translations[m.id].text }}（点击重试）
                  </button>
                  <div v-else>
                    <p
                      :class="`whitespace-pre-wrap break-words text-sm leading-relaxed ${
                        m.from_uid === me.uid ? 'text-emerald-50' : 'text-gray-700'
                      }`"
                    >
                      {{ translations[m.id].text }}
                    </p>
                    <button
                      type="button"
                      @click="setTranslationStatus(m.id, 'idle')"
                      :class="`mt-0.5 text-[10px] ${m.from_uid === me.uid ? 'text-emerald-100/80' : 'text-gray-400'}`"
                    >
                      DeepSeek 翻译 · 收起
                    </button>
                  </div>
                </div>
              </div>
            </template>
            <button v-else-if="m.kind === 'image'" type="button" @click="preview = m.content" aria-label="查看图片">
              <img :src="m.content" alt="图片消息" loading="lazy" class="max-h-56 rounded-lg" />
            </button>
            <AudioBubble v-else-if="m.kind === 'audio'" :src="m.content" :duration="m.duration" />
            <p :class="`mt-1 text-right text-[10px] ${m.from_uid === me.uid ? 'text-emerald-100/80' : 'text-gray-300'}`">
              {{ formatTime(m.created_at) }}
            </p>
          </div>
        </div>
      </main>

      <footer class="safe-bottom border-t border-gray-200 bg-white px-3 pt-2.5">
        <div v-if="recording" class="flex items-center gap-3 pb-1">
          <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span class="flex-1 text-sm font-medium text-red-500">录音中 {{ recording.seconds }}s</span>
          <button
            type="button"
            @click="stopRecording(true)"
            class="rounded-full px-3 py-2 text-sm text-gray-500 active:bg-gray-100"
          >
            取消
          </button>
          <button
            type="button"
            @click="stopRecording(false)"
            class="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white active:bg-emerald-700"
          >
            发送
          </button>
        </div>
        <div v-else-if="translating" class="flex items-center gap-2 pb-2 text-sm text-gray-500">
          <Loader2 class="h-4 w-4 animate-spin text-emerald-500" />
          DeepSeek 翻译中…
        </div>
        <div v-else-if="listening" class="pb-1">
          <div class="flex items-center gap-2">
            <template v-if="listening.active">
              <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
              <span class="min-w-0 flex-1 truncate text-sm text-emerald-600">
                正在识别{{ STT_LABEL[listening.lang] }} · {{ listening.seconds }}s
              </span>
              <button
                type="button"
                @click="stopListening"
                class="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white active:bg-emerald-700"
              >
                完成
              </button>
            </template>
            <template v-else>
              <span class="min-w-0 flex-1 truncate text-sm text-gray-500">
                {{ listening.lang ? '已停止，可换语言重新识别' : '选择语言，开始说话' }}
              </span>
              <button
                type="button"
                @click="stopListening"
                class="rounded-full px-3 py-2 text-sm text-gray-500 active:bg-gray-100"
              >
                关闭
              </button>
            </template>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              v-for="[code, label] in STT_LANGS"
              :key="code"
              type="button"
              @click="startListening(code)"
              :class="`rounded-full px-2.5 py-1 text-xs ${
                listening.lang === code && listening.active
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-600 active:bg-gray-200'
              }`"
            >
              {{ label }}
            </button>
            <span class="mx-0.5 h-4 w-px bg-gray-200" />
            <span class="text-xs text-gray-400">译成</span>
            <button
              v-for="[code, label] in TRANS_LANGS"
              :key="code"
              type="button"
              @click="translateDraft(code)"
              :disabled="!draft.trim()"
              class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 active:bg-emerald-100 disabled:opacity-40"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <form v-else @submit="sendText" class="flex items-center gap-1.5 pb-1">
          <button
            type="button"
            @click="fileRef?.click()"
            :disabled="sending"
            aria-label="发送图片"
            class="p-2 text-gray-500 active:text-emerald-600"
          >
            <ImagePlus class="h-6 w-6" />
          </button>
          <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="sendImage" />
          <input
            v-model="draft"
            placeholder="输入消息…"
            maxlength="2000"
            class="min-w-0 flex-1 rounded-full border border-gray-200 bg-gray-50 px-3.5 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            @click="listening = { lang: null, active: false, seconds: 0 }"
            aria-label="语音转文字"
            class="p-2 text-gray-500 active:text-emerald-600"
          >
            <AudioLines class="h-6 w-6" />
          </button>
          <button
            v-if="draft.trim()"
            type="submit"
            :disabled="sending"
            aria-label="发送"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white active:bg-emerald-700 disabled:opacity-50"
          >
            <Send class="h-5 w-5" />
          </button>
          <button
            v-else
            type="button"
            @click="startRecording"
            :disabled="sending"
            aria-label="录制语音"
            class="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 active:text-emerald-600"
          >
            <Mic class="h-6 w-6" />
          </button>
        </form>
      </footer>

      <div
        v-if="preview"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
        @click="preview = null"
      >
        <img :src="preview" alt="查看图片" class="max-h-full max-w-full rounded-lg object-contain" />
        <button class="absolute right-3 top-3 p-2 text-white" aria-label="关闭预览">
          <X class="h-6 w-6" />
        </button>
      </div>
    </div>
  </div>
</template>

<script>
const AUDIO_EXTS = {
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
}

const STT_LANGS = [
  ['zh-CN', '中文'],
  ['en-US', 'English'],
  ['ru-RU', 'Русский'],
]
const TRANS_LANGS = [
  ['zh', '中文'],
  ['en', 'English'],
  ['ru', 'Русский'],
]
const STT_LABEL = { 'zh-CN': '中文', 'en-US': '英文', 'ru-RU': '俄文' }

export default {}
</script>
