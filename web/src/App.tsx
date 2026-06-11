import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from '@assistant-ui/react'
import ReactMarkdown from 'react-markdown'
import {
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  LoaderCircle,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  askDivination,
  ApiError,
  deleteConversation,
  inviteLogin,
  listConversations,
  loadDivinationReading,
  loadConversationMessages,
  refreshAccessToken,
  streamDivinationSummary,
  type AuthUser,
  type ConversationSummary,
  type DivinationAskBody,
  type DivinationMethod,
} from './lib/api'
import { fromApiMessages, type OrbitUiMessage, useOrbitAssistantRuntime } from './hooks/useOrbitAssistantRuntime'

const TOKEN_KEY = 'orbit.web.accessToken'
const REFRESH_TOKEN_KEY = 'orbit.web.refreshToken'
const USER_KEY = 'orbit.web.user'
const DEFAULT_DIVINATION_PROMPT = '请结合卦象分析、解答问题。'

type DetailPanel = 'chart' | 'why' | null
type AnalysisMode = 'quick' | 'deep'
type CastingStage = 'idle' | 'casting' | 'analysis' | 'summary' | 'done' | 'error'

interface CastingProgress {
  stage: CastingStage
  label: string
  percent: number
}

const IDLE_PROGRESS: CastingProgress = {
  stage: 'idle',
  label: '等待起卦',
  percent: 0,
}

const CASTING_PROGRESS: Record<Exclude<CastingStage, 'idle'>, CastingProgress> = {
  casting: { stage: 'casting', label: '排盘起卦', percent: 28 },
  analysis: { stage: 'analysis', label: '推演分析', percent: 58 },
  summary: { stage: 'summary', label: '生成短答', percent: 84 },
  done: { stage: 'done', label: '完成', percent: 100 },
  error: { stage: 'error', label: '出错', percent: 100 },
}

const METHODS: Array<{ id: DivinationMethod; label: string; hint: string }> = [
  { id: 'coins', label: '自动摇卦', hint: '模拟三枚硬币摇六次' },
  { id: 'manual', label: '手动六爻', hint: '输入 6 个 6/7/8/9' },
  { id: 'time', label: '时间起卦', hint: '按当前时间取卦' },
  { id: 'numbers', label: '数字起卦', hint: '输入 3 个数字' },
  { id: 'character', label: '汉字起卦', hint: '输入 1 个汉字' },
]

function makeSessionId() {
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isAuthExpiredError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === 'TOKEN_EXPIRED' || error.status === 401
  }
  return error instanceof Error && error.message === 'Token has expired'
}

function isCompactViewport() {
  return window.matchMedia('(max-width: 760px)').matches
}

function formatTime(value?: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function makeUiMessage(role: OrbitUiMessage['role'], content: string): OrbitUiMessage {
  return {
    id: `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date(),
    status: role === 'assistant' ? { type: 'complete', reason: 'stop' } : undefined,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function textValue(value: unknown, fallback = '?') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function chartTime(reading: Record<string, unknown> | null): Record<string, unknown> {
  return asRecord(asRecord(reading?.chart).time)
}

function formatCastingDate(reading: Record<string, unknown> | null): string {
  const datetime = chartTime(reading).datetime
  if (typeof datetime !== 'string' || !datetime) return '未记录起卦时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: textValue(chartTime(reading).timezone, 'Asia/Shanghai'),
  }).format(new Date(datetime))
}

function chartSummaryItems(reading: Record<string, unknown> | null): Array<{ label: string; value: string }> {
  if (!reading) return []
  const chart = asRecord(reading.chart)
  const original = asRecord(chart.originalHexagram)
  const changed = asRecord(chart.changedHexagram)
  const time = chartTime(reading)
  const lines = arrayValue(chart.lines).map(asRecord)
  const shi = lines.find((line) => line.isShi)
  const ying = lines.find((line) => line.isYing)
  const pillars = [
    time.yearPillar && `${time.yearPillar}年`,
    time.monthPillar && `${time.monthPillar}月`,
    time.dayPillar && `${time.dayPillar}日`,
    time.hourPillar && `${time.hourPillar}时`,
  ].filter(Boolean).join(' ')
  const moving = arrayValue(chart.movingLines).join('、') || '无'
  return [
    { label: '起卦', value: formatCastingDate(reading) },
    { label: '本卦', value: textValue(original.fullName, textValue(original.name)) },
    ...(hasChangedHexagram(reading)
      ? [{ label: '变卦', value: textValue(changed.fullName, textValue(changed.name)) }]
      : []),
    { label: '卦宫', value: `${textValue(original.palace)}宫 · ${textValue(original.palaceType)} · ${textValue(original.element)}` },
    { label: '动爻', value: moving },
    ...(pillars ? [{ label: '四柱', value: pillars }] : []),
    ...(Array.isArray(time.xunkong) ? [{ label: '旬空', value: time.xunkong.join('、') }] : []),
    ...(time.solarTerm ? [{ label: '节气', value: textValue(time.solarTerm) }] : []),
    ...(shi ? [{ label: '世爻', value: `第${shi.position}爻 ${textValue(shi.branch, '')} ${textValue(shi.sixRelative, '')} 临${textValue(shi.sixGod, '')}` }] : []),
    ...(ying ? [{ label: '应爻', value: `第${ying.position}爻 ${textValue(ying.branch, '')} ${textValue(ying.sixRelative, '')} 临${textValue(ying.sixGod, '')}` }] : []),
  ]
}

function parseNumbersInput(value: string): number[] | null {
  const numbers = value
    .trim()
    .split(/[\s,，]+/)
    .filter(Boolean)
    .map(Number)
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : null
}

function parseManualInput(value: string): { bits?: number[]; yaoValues?: number[] } | null {
  const values = value
    .trim()
    .split(/[\s,，]+/)
    .filter(Boolean)
    .map(Number)
  if (values.length !== 6 || !values.every(Number.isFinite)) return null
  if (values.every((item) => item === 0 || item === 1)) return { bits: values }
  if (values.every((item) => [6, 7, 8, 9].includes(item))) return { yaoValues: values }
  return null
}

function cleanReportForDisplay(value: unknown): string {
  return String(value || '')
    .replace(/\n## 引用[\s\S]*$/m, '')
    .replace(/\s*(?:\[|【)cite:[^\]】]+(?:\]|】)/g, '')
    .replace(/\[[0-9,\s]+\]/g, '')
    .trim()
}

function LoadingSpinner({ label = '加载中' }: { label?: string }) {
  return <LoaderCircle className="loading-spinner" size={16} aria-label={label} />
}

function isYang(value: unknown): boolean {
  return String(value || '').includes('阳') || value === 1
}

function hasChangedHexagram(reading: Record<string, unknown> | null): boolean {
  if (!reading) return false
  const chart = asRecord(reading.chart)
  return arrayValue(chart.movingLines).length > 0
}

function lineEntity(line: Record<string, unknown>, changed = false): string {
  const prefix = changed ? 'changed' : ''
  const field = (name: string, fallback = '') => {
    const changedName = prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name
    return textValue(line[changedName], textValue(line[name], fallback))
  }
  return `${field('sixRelative')}${field('stem')}${field('branch')}${field('element')}`.replace(/\?/g, '')
}

function hiddenEntity(item: Record<string, unknown>): string {
  const relative = textValue(item.relative, textValue(item.sixRelative, ''))
  const stem = textValue(item.fushenStem, textValue(item.stem, ''))
  const branch = textValue(item.fushenBranch, textValue(item.branch, ''))
  const element = textValue(item.fushenElement, textValue(item.element, ''))
  const classical = textValue(item.classicalName, '')
  const entity = `${relative}${stem}${branch}${element}`.replace(/\?/g, '')
  return classical ? `${entity} · ${classical}` : entity
}

function hiddenLineText(line: Record<string, unknown>): string {
  const direct = textValue(line.hiddenText, '')
  if (direct) return direct
  const hidden = asRecord(line.hiddenGod || line.fushen || line.hidden)
  if (Object.keys(hidden).length) return hiddenEntity(hidden)
  const hiddenList = arrayValue(line.hiddenGods || line.fushenList).map(asRecord).map((item) => hiddenEntity(item)).filter(Boolean)
  return hiddenList.join('、')
}

function twelveStageText(line: Record<string, unknown>): string {
  const stage = asRecord(line.twelveStage)
  const parts = [
    textValue(stage.byDay, '') ? `日辰${textValue(stage.byDay, '')}` : '',
    textValue(stage.byChangedBranch, '') ? `动化${textValue(stage.byChangedBranch, '')}` : '',
  ].filter(Boolean)
  return parts.join(' / ')
}

function hexagramSubtitle(hexagram: Record<string, unknown>): string {
  const palace = textValue(hexagram.palace, '').replace(/宫$/, '')
  const palaceType = textValue(hexagram.palaceType, '')
  return [palace, palaceType].filter(Boolean).join('·')
}

function ChartLineSymbol({ yang }: { yang: boolean }) {
  return (
    <span className="traditional-line-symbol" data-yang={yang ? 'true' : undefined}>
      <span />
      {!yang ? <span /> : null}
    </span>
  )
}

function TraditionalChartHeader({ reading }: { reading: Record<string, unknown> | null }) {
  const time = chartTime(reading)
  const pillar = (key: 'year' | 'month' | 'day' | 'hour') => {
    const ready = textValue(time[`${key}Pillar`], '')
    if (ready) return ready
    return `${textValue(time[`${key}Stem`], '')}${textValue(time[`${key}Branch`], '')}`
  }
  const xunkong = Array.isArray(time.xunkong) ? time.xunkong.join('') : textValue(time.xunkong, '')
  return (
    <div className="traditional-chart-header" aria-label="起卦四柱">
      <span>{pillar('year')}年</span>
      <span className="chart-red">{pillar('month')}月</span>
      <span className="chart-red">{pillar('day')}日</span>
      <span>{pillar('hour')}时</span>
      {xunkong ? (
        <span>
          （旬空 <em>{xunkong}</em>）
        </span>
      ) : null}
    </div>
  )
}

function TraditionalHexagramColumn({
  title,
  subtitle,
  lines,
  changed,
}: {
  title: string
  subtitle: string
  lines: Record<string, unknown>[]
  changed?: boolean
}) {
  const ordered = [...lines].sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
  return (
    <div className="traditional-hexagram" data-changed={changed ? 'true' : undefined}>
      <div className="traditional-title">
        <strong>{title}</strong>
        {subtitle ? <span>（{subtitle}）</span> : null}
      </div>
      <div className="traditional-lines" aria-label={title}>
        {ordered.map((line) => {
          const hidden = hiddenLineText(line)
          return (
            <div className="traditional-line-wrap" key={`${title}-${line.position}`}>
              <div className="traditional-line-row">
                <span className="line-god">{changed ? '' : textValue(line.sixGod, '')}</span>
                {changed && line.moving ? <span className="moving-mark">O</span> : <span className="moving-mark" />}
                <span className="line-entity">{lineEntity(line, changed)}</span>
                <ChartLineSymbol yang={isYang(changed ? line.changedYinYang : line.yinYang)} />
                <span className="line-marker">{line.isShi ? '世' : line.isYing ? '应' : ''}</span>
              </div>
              {!changed && hidden ? <div className="hidden-line-note">↑伏：{hidden}</div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TraditionalHexagramChart({ reading }: { reading: Record<string, unknown> | null }) {
  if (!reading) return null
  const chart = asRecord(reading.chart)
  const original = asRecord(chart.originalHexagram)
  const changed = asRecord(chart.changedHexagram)
  const lines = arrayValue(chart.lines).map(asRecord)
  const showChanged = hasChangedHexagram(reading)

  return (
    <div className="traditional-chart">
      <TraditionalChartHeader reading={reading} />
      <div className="traditional-chart-columns" data-single={!showChanged ? 'true' : undefined}>
        <TraditionalHexagramColumn
        title={textValue(original.fullName, textValue(original.name, '本卦'))}
        subtitle={hexagramSubtitle(original)}
        lines={lines}
      />
      {showChanged ? (
        <TraditionalHexagramColumn
          title={textValue(changed.fullName, textValue(changed.name, '变卦'))}
          subtitle={hexagramSubtitle(changed)}
          lines={lines}
          changed
        />
      ) : null}
      </div>
    </div>
  )
}

function HexagramDetail({ reading }: { reading: Record<string, unknown> | null }) {
  if (!reading) return <p className="detail-empty">当前没有可展示的卦象。</p>
  const lines = arrayValue(asRecord(reading.chart).lines).map(asRecord)
  return (
    <div className="chart-detail-layout">
      <div className="chart-visual-panel">
        <div className="casting-date">
          <CalendarDays size={16} />
          <span>{formatCastingDate(reading)}</span>
        </div>
        <TraditionalHexagramChart reading={reading} />
      </div>
      <div className="chart-facts" aria-label="排盘信息">
        {chartSummaryItems(reading).map((item) => (
          <div key={item.label} className="chart-fact">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="yao-table" aria-label="六爻明细">
        <div className="yao-table-head">六爻明细</div>
        {[...lines].reverse().map((line) => (
          <div className="yao-row" key={`yao-${line.position}`}>
            <span>{textValue(line.position, '')}</span>
            <strong>{textValue(line.stem, '')}{textValue(line.branch, '')} {textValue(line.element, '')}</strong>
            <em>{textValue(line.sixRelative, '')}</em>
            <small>
              {textValue(line.sixGod, '')}
              {line.isShi ? ' · 世' : ''}
              {line.isYing ? ' · 应' : ''}
              {line.moving ? ' · 动' : ''}
              {hiddenLineText(line) ? ` · 伏：${hiddenLineText(line)}` : ''}
              {twelveStageText(line) ? ` · 十二长生：${twelveStageText(line)}` : ''}
            </small>
          </div>
        ))}
      </div>
    </div>
  )
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (token: string, refreshToken: string, user: AuthUser) => void
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return

    setLoading(true)
    setError('')
    try {
      const data = await inviteLogin(code)
      localStorage.setItem(TOKEN_KEY, data.accessToken)
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
      onLogin(data.accessToken, data.refreshToken, data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '邀请码不可用')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-lockup">
          <span className="brand-mark">OA</span>
          <div>
            <p className="eyebrow">OrbitAgent</p>
            <h1 id="login-title">邀请码访问</h1>
          </div>
        </div>

        <form className="invite-form" onSubmit={submit}>
          <label htmlFor="invite-code">邀请码</label>
          <input
            id="invite-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ORB-XXXX-XXXX-XXXX"
            autoComplete="one-time-code"
            spellCheck={false}
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" disabled={loading || !code.trim()}>
            {loading ? (
              <>
                <LoadingSpinner />
                校验中
              </>
            ) : (
              '进入'
            )}
          </button>
        </form>
      </section>
    </main>
  )
}

function ChatMessage() {
  const role = useMessage((message) => message.role)
  const status = useMessage((message) => message.status)
  const content = useMessage((message) =>
    message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('\n')
      .trim(),
  )
  const cleanedContent = cleanReportForDisplay(content)
  const isRunningMessage = role === 'assistant' && status?.type === 'running'

  return (
    <MessagePrimitive.Root className="chat-message" data-role={role}>
      <div className="message-bubble">
        {cleanedContent ? <ReactMarkdown>{cleanedContent}</ReactMarkdown> : null}
        {isRunningMessage ? (
          <span className="message-loading">
            <LoadingSpinner />
            {cleanedContent ? '生成中' : 'Roy 正在回复'}
          </span>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  )
}

function EmptyThread() {
  return (
    <ThreadPrimitive.Empty>
      <div className="empty-thread">
        <p className="empty-kicker">OrbitAgent</p>
        <h2>开始新的对话</h2>
      </div>
    </ThreadPrimitive.Empty>
  )
}

function ConversationList({
  conversations,
  activeSessionId,
  onSelect,
  onDelete,
}: {
  conversations: ConversationSummary[]
  activeSessionId: string
  onSelect: (conversation: ConversationSummary) => void
  onDelete: (conversation: ConversationSummary) => void
}) {
  if (conversations.length === 0) {
    return <p className="history-empty">暂无历史</p>
  }

  return (
    <nav className="conversation-list" aria-label="对话历史">
      {conversations.map((conversation) => (
        <button
          type="button"
          className="conversation-item"
          data-active={conversation.sessionId === activeSessionId ? 'true' : undefined}
          key={conversation.sessionId}
          onClick={() => onSelect(conversation)}
        >
          <span>
            <strong>{conversation.title || 'New Conversation'}</strong>
            <small>{formatTime(conversation.updatedAt)}</small>
          </span>
          <Trash2
            aria-label="删除"
            className="delete-icon"
            size={16}
            onClick={(event) => {
              event.stopPropagation()
              onDelete(conversation)
            }}
          />
        </button>
      ))}
    </nav>
  )
}

function DetailBlock({
  panel,
  reading,
  onClose,
}: {
  panel: DetailPanel
  reading: Record<string, unknown> | null
  onClose: () => void
}) {
  if (!panel) return null
  const title = {
    chart: '卦象',
    why: '解读详情',
  }[panel]
  const lines = cleanReportForDisplay(reading?.content ?? '当前没有可展开的完整报告。').split('\n').slice(0, 160)

  return (
    <section className="detail-block" aria-label={title}>
      <div className="detail-head">
        <p>{title}</p>
        <button type="button" onClick={onClose} aria-label="关闭详情">
          <X size={16} />
        </button>
      </div>
      {panel === 'chart' ? (
        <HexagramDetail reading={reading} />
      ) : (
        <div className="markdown-detail">
          <ReactMarkdown>{lines.join('\n')}</ReactMarkdown>
        </div>
      )}
    </section>
  )
}

function ReadingAttachmentPanel({
  reading,
  activePanel,
  onPanelChange,
}: {
  reading: Record<string, unknown> | null
  activePanel: DetailPanel
  onPanelChange: (panel: DetailPanel) => void
}) {
  if (!reading) return null

  const button = (panel: Exclude<DetailPanel, null>, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      data-active={activePanel === panel ? 'true' : undefined}
      onClick={() => onPanelChange(activePanel === panel ? null : panel)}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="attachment-panel" aria-label="起卦附件">
      <div className="attachment-tools">
        <span>
          <Paperclip size={15} />
          <span>
            起卦资料
            <small>AI 先给概要，可在这里打开卦象和完整解读。</small>
          </span>
        </span>
        <div>
          {button('chart', <FileText size={15} />, '卦象')}
          {button('why', <BookOpen size={15} />, '解读')}
        </div>
      </div>
    </div>
  )
}

function CastingProgressBar({ progress }: { progress: CastingProgress }) {
  const steps: Array<{ stage: Exclude<CastingStage, 'idle' | 'error'>; label: string }> = [
    { stage: 'casting', label: '排盘' },
    { stage: 'analysis', label: '分析' },
    { stage: 'summary', label: '短答' },
    { stage: 'done', label: '完成' },
  ]
  const activeIndex = Math.max(0, steps.findIndex((item) => item.stage === progress.stage))
  const done = progress.stage === 'done'
  const error = progress.stage === 'error'

  return (
    <div className="casting-progress" data-state={progress.stage} aria-label="起卦进度">
      <div className="casting-progress-head">
        <span>{progress.label}</span>
        <strong>{progress.percent}%</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="progress-steps">
        {steps.map((step, index) => {
          const reached = done || progress.stage === step.stage || index < activeIndex
          return (
            <span key={step.stage} data-active={reached ? 'true' : undefined}>
              {reached ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              {step.label}
            </span>
          )
        })}
      </div>
      {error ? <p>本次起卦没有完成，请调整输入后重试。</p> : null}
    </div>
  )
}

function DivinationWorkbench({
  method,
  question,
  methodInput,
  analysisMode,
  angles,
  running,
  progress,
  reading,
  activePanel,
  onMethodChange,
  onQuestionChange,
  onMethodInputChange,
  onAnalysisModeChange,
  onAnglesChange,
  onSubmit,
  onPanelChange,
}: {
  method: DivinationMethod
  question: string
  methodInput: string
  analysisMode: AnalysisMode
  angles: number
  running: boolean
  progress: CastingProgress
  reading: Record<string, unknown> | null
  activePanel: DetailPanel
  onMethodChange: (method: DivinationMethod) => void
  onQuestionChange: (question: string) => void
  onMethodInputChange: (value: string) => void
  onAnalysisModeChange: (mode: AnalysisMode) => void
  onAnglesChange: (angles: number) => void
  onSubmit: () => void
  onPanelChange: (panel: DetailPanel) => void
}) {
  const methodHelp = {
    coins: '直接输入问题即可，系统会自动摇卦。',
    manual: '输入 6 个爻值，顺序为初爻到上爻，例如 7 8 7 9 7 8。',
    time: '直接输入问题即可，系统按当前时间起卦。',
    numbers: '输入 3 个数字：上卦、下卦、动爻，例如 2 9 5。',
    character: '输入 1 个汉字，例如 财。',
  }[method]
  const inputLabel = method === 'manual' ? '六爻值' : method === 'numbers' ? '三数' : method === 'character' ? '汉字' : ''

  return (
    <section className="workbench" aria-label="六爻交互工作台">
      <div className="workbench-head">
        <div>
          <p className="eyebrow">Flow</p>
          <h2>起卦工作台</h2>
        </div>
        <div className="flow-steps" aria-label="流程">
          <span data-active="true">方式</span>
          <span data-active={question.trim() ? 'true' : undefined}>问题</span>
          <span data-active={reading ? 'true' : undefined}>推演</span>
        </div>
      </div>
      <CastingProgressBar progress={progress} />

      <div className="method-grid" role="group" aria-label="起卦方式">
        {METHODS.map((item) => (
          <button
            type="button"
            key={item.id}
            className="method-card"
            data-active={method === item.id ? 'true' : undefined}
            onClick={() => onMethodChange(item.id)}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>

      <div className="question-grid">
        <label>
          <span>问题</span>
          <textarea
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="请输入你要占问的问题..."
            rows={3}
          />
        </label>
        {inputLabel ? (
          <label>
            <span>{inputLabel}</span>
            <input
              value={methodInput}
              onChange={(event) => onMethodInputChange(event.target.value)}
              placeholder={methodHelp}
            />
          </label>
        ) : null}
        <p className="method-help">{methodHelp}</p>
      </div>

      <div className="action-row">
        <div className="mode-toggle" role="group" aria-label="分析模式">
          <button
            type="button"
            data-active={analysisMode === 'quick' ? 'true' : undefined}
            onClick={() => onAnalysisModeChange('quick')}
          >
            <Sparkles size={16} />
            快速分析
          </button>
          <button
            type="button"
            data-active={analysisMode === 'deep' ? 'true' : undefined}
            onClick={() => onAnalysisModeChange('deep')}
          >
            <Brain size={16} />
            深度推演
          </button>
        </div>
        {analysisMode === 'deep' ? (
          <label className="angle-control">
            <span>{angles} angles</span>
            <input
              type="range"
              min="1"
              max="5"
              value={angles}
              onChange={(event) => onAnglesChange(Number(event.target.value))}
            />
          </label>
        ) : null}
        <button className="primary-action" type="button" onClick={onSubmit} disabled={running || !question.trim()}>
          {running ? <LoadingSpinner /> : <Play size={17} />}
          {running ? '推演中' : '开始推演'}
        </button>
      </div>

      <div className="command-row" aria-label="命令操作">
        <button type="button" onClick={() => onPanelChange(activePanel === 'chart' ? null : 'chart')} disabled={!reading}>
          <FileText size={16} />
          卦象
        </button>
        <button type="button" onClick={() => onPanelChange(activePanel === 'why' ? null : 'why')} disabled={!reading}>
          <BookOpen size={16} />
          解读
        </button>
      </div>

      <DetailBlock panel={activePanel} reading={reading} onClose={() => onPanelChange(null)} />
    </section>
  )
}

function AuthedApp({
  token,
  refreshToken,
  user,
  onTokenRefresh,
  onLogout,
}: {
  token: string
  refreshToken: string
  user: AuthUser
  onTokenRefresh: (token: string, refreshToken: string) => void
  onLogout: () => void
}) {
  const [sessionId, setSessionId] = useState(makeSessionId)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(() => !isCompactViewport())
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [method, setMethod] = useState<DivinationMethod>('coins')
  const [question, setQuestion] = useState('')
  const [methodInput, setMethodInput] = useState('')
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('quick')
  const [angles, setAngles] = useState(3)
  const [workflowError, setWorkflowError] = useState('')
  const [readingsBySession, setReadingsBySession] = useState<Record<string, Record<string, unknown> | null>>({})
  const [readySessions, setReadySessions] = useState<Record<string, boolean>>({})
  const [castingProgressBySession, setCastingProgressBySession] = useState<Record<string, CastingProgress>>({})
  const [activePanel, setActivePanel] = useState<DetailPanel>(null)
  const tokenRef = useRef(token)
  const refreshTokenRef = useRef(refreshToken)
  const refreshPromiseRef = useRef<Promise<string> | null>(null)
  const activeSessionRef = useRef(sessionId)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  useEffect(() => {
    activeSessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    refreshTokenRef.current = refreshToken
  }, [refreshToken])

  const refreshAuth = useCallback(async () => {
    if (!refreshTokenRef.current) {
      onLogout()
      throw new Error('登录已过期，请重新输入邀请码')
    }

    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = refreshAccessToken(refreshTokenRef.current)
        .then((data) => {
          tokenRef.current = data.accessToken
          refreshTokenRef.current = data.refreshToken
          onTokenRefresh(data.accessToken, data.refreshToken)
          return data.accessToken
        })
        .catch((error) => {
          onLogout()
          throw error
        })
        .finally(() => {
          refreshPromiseRef.current = null
        })
    }

    return refreshPromiseRef.current
  }, [onLogout, onTokenRefresh])

  const withAuthRetry = useCallback(
    async <T,>(operation: (accessToken: string) => Promise<T>): Promise<T> => {
      try {
        return await operation(tokenRef.current)
      } catch (error) {
        if (!isAuthExpiredError(error)) throw error
        const nextToken = await refreshAuth()
        return operation(nextToken)
      }
    },
    [refreshAuth],
  )

  const setSessionProgress = useCallback((targetSessionId: string, progress: CastingProgress) => {
    setCastingProgressBySession((current) => ({ ...current, [targetSessionId]: progress }))
  }, [])

  const activeReading = readingsBySession[sessionId] ?? null
  const activeConversationReady = !!readySessions[sessionId]
  const activeCastingProgress = castingProgressBySession[sessionId] ?? IDLE_PROGRESS
  const activeWorkflowRunning = ['casting', 'analysis', 'summary'].includes(activeCastingProgress.stage)

  const refreshConversations = useCallback(async () => {
    try {
      const nextConversations = await withAuthRetry((accessToken) => listConversations(accessToken))
      setConversations(nextConversations)
      setHistoryError('')
    } catch (err) {
      if (isAuthExpiredError(err)) return
      setHistoryError(err instanceof Error ? err.message : '历史加载失败')
    }
  }, [withAuthRetry])

  const { runtime, setSessionMessages, isRunning, runningSessions } = useOrbitAssistantRuntime({
    token,
    sessionId,
    isSendDisabled: !activeConversationReady || activeWorkflowRunning,
    onSessionResolved: setSessionId,
    onConversationChanged: refreshConversations,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshConversations()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshConversations])

  const activeTitle = useMemo(() => {
    if (!activeConversationReady) return '起卦工作台'
    return conversations.find((item) => item.sessionId === sessionId)?.title ?? '追问对话'
  }, [activeConversationReady, conversations, sessionId])
  const pageBusy = historyLoading || activeWorkflowRunning || isRunning
  const backgroundTaskCount = Object.entries(castingProgressBySession).filter(([targetSessionId, progress]) =>
    targetSessionId !== sessionId && ['casting', 'analysis', 'summary'].includes(progress.stage),
  ).length + Object.keys(runningSessions).filter((item) => item !== sessionId).length

  const selectConversation = async (conversation: ConversationSummary) => {
    const hasBackgroundOutput = !!runningSessions[conversation.sessionId]
    setSessionId(conversation.sessionId)
    if (isCompactViewport()) setSidebarOpen(false)
    setActivePanel(null)
    setReadySessions((current) => ({ ...current, [conversation.sessionId]: true }))
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const [apiMessages, reading] = await withAuthRetry(async (accessToken) => {
        const readingPromise = loadDivinationReading(accessToken, conversation.sessionId).catch((error) => {
          if (isAuthExpiredError(error)) throw error
          return null
        })
        return Promise.all([
          loadConversationMessages(accessToken, conversation.sessionId),
          readingPromise,
        ])
      })
      if (hasBackgroundOutput) {
        setSessionMessages(conversation.sessionId, (current) =>
          current.length ? current : fromApiMessages(apiMessages),
        )
      } else {
        setSessionMessages(conversation.sessionId, fromApiMessages(apiMessages))
      }
      setReadingsBySession((current) => ({ ...current, [conversation.sessionId]: reading }))
    } catch (err) {
      if (isAuthExpiredError(err)) return
      setHistoryError(err instanceof Error ? err.message : '对话加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  const startNewConversation = () => {
    const nextSessionId = makeSessionId()
    setSessionId(nextSessionId)
    setSessionMessages(nextSessionId, [])
    setQuestion('')
    setMethodInput('')
    setWorkflowError('')
    setActivePanel(null)
    setReadingsBySession((current) => ({ ...current, [nextSessionId]: null }))
    setReadySessions((current) => ({ ...current, [nextSessionId]: false }))
    setSessionProgress(nextSessionId, IDLE_PROGRESS)
    if (isCompactViewport()) setSidebarOpen(false)
  }

  const removeConversation = async (conversation: ConversationSummary) => {
    await withAuthRetry((accessToken) => deleteConversation(accessToken, conversation.sessionId))
    if (conversation.sessionId === sessionId) startNewConversation()
    await refreshConversations()
  }

  const buildCastingBody = (): Pick<DivinationAskBody, 'bits' | 'yaoValues' | 'casting'> | null => {
    if (method === 'coins' || method === 'time') return { casting: { method } }
    if (method === 'manual') return parseManualInput(methodInput)
    if (method === 'numbers') {
      const numbers = parseNumbersInput(methodInput)
      return numbers ? { casting: { method, numbers } } : null
    }
    const character = Array.from(methodInput.trim())[0]
    return character && Array.from(methodInput.trim()).length === 1
      ? { casting: { method, character } }
      : null
  }

  const runDivination = async () => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || activeWorkflowRunning) return

    const castingBody = buildCastingBody()
    if (!castingBody) {
      setWorkflowError(
        method === 'manual'
          ? '请输入 6 个爻值，例如：7 8 7 9 7 8。'
          : method === 'numbers'
            ? '请输入 3 个数字，例如：2 9 5。'
            : '请输入 1 个汉字。',
      )
      return
    }

    const targetSessionId = makeSessionId()
    setSessionId(targetSessionId)
    setWorkflowError('')
    setActivePanel(null)
    setReadySessions((current) => ({ ...current, [targetSessionId]: false }))
    setReadingsBySession((current) => ({ ...current, [targetSessionId]: null }))
    setSessionMessages(targetSessionId, [])
    setSessionProgress(targetSessionId, CASTING_PROGRESS.casting)
    const analysisTimer = window.setTimeout(() => {
      setSessionProgress(targetSessionId, CASTING_PROGRESS.analysis)
    }, 450)

    try {
      const data = await withAuthRetry((accessToken) => askDivination(accessToken, {
        sessionId: targetSessionId,
        question: trimmedQuestion,
        message: DEFAULT_DIVINATION_PROMPT,
        timezone: 'Asia/Shanghai',
        datetime: new Date().toISOString(),
        debug: import.meta.env.DEV,
        thinking: analysisMode === 'deep',
        angles,
        ...castingBody,
      }))
      window.clearTimeout(analysisTimer)
      const resolvedSession = typeof data.sessionId === 'string' ? data.sessionId : targetSessionId
      const assistantId = `assistant_summary_${Date.now().toString(36)}`
      if (activeSessionRef.current === targetSessionId && resolvedSession !== targetSessionId) {
        setSessionId(resolvedSession)
      }
      setReadingsBySession((current) => ({ ...current, [resolvedSession]: data }))
      setReadySessions((current) => ({ ...current, [resolvedSession]: true }))
      setSessionProgress(resolvedSession, CASTING_PROGRESS.summary)
      setSessionMessages(resolvedSession, [
        makeUiMessage('user', trimmedQuestion),
        {
          id: assistantId,
          role: 'assistant',
          content: 'Roy 正在生成短答...',
          createdAt: new Date(),
          status: { type: 'running' },
        },
      ])

      let summary = ''
      for await (const event of streamDivinationSummary(tokenRef.current, {
        sessionId: resolvedSession,
        question: trimmedQuestion,
        chart: data.chart,
        content: cleanReportForDisplay(data.content),
        agentId: String(data.agentId || 'default'),
      })) {
        if (event.type === 'content' && event.content) {
          summary += event.content
          setSessionMessages(resolvedSession, (current) =>
            current.map((item) =>
              item.id === assistantId
                ? { ...item, content: summary, status: { type: 'running' } }
                : item,
            ),
          )
        }
        if (event.type === 'done') {
          const finalSummary = cleanReportForDisplay(event.content || summary || '推演完成。')
          setSessionMessages(resolvedSession, (current) =>
            current.map((item) =>
              item.id === assistantId
                ? { ...item, content: finalSummary, status: { type: 'complete', reason: 'stop' } }
                : item,
            ),
          )
          setSessionProgress(resolvedSession, CASTING_PROGRESS.done)
        }
        if (event.type === 'error') {
          throw new Error(event.error || '短答生成失败')
        }
      }
      await refreshConversations()
    } catch (err) {
      window.clearTimeout(analysisTimer)
      if (isAuthExpiredError(err)) {
        await refreshAuth().catch(() => null)
        setWorkflowError('登录已续期，请重新点击开始推演。')
        setSessionProgress(targetSessionId, CASTING_PROGRESS.error)
        return
      }
      const message = err instanceof Error ? err.message : '推演失败'
      setWorkflowError(message)
      setReadySessions((current) => ({ ...current, [targetSessionId]: false }))
      setSessionProgress(targetSessionId, CASTING_PROGRESS.error)
      setSessionMessages(targetSessionId, [])
    } finally {
      window.clearTimeout(analysisTimer)
      if ((castingProgressBySession[targetSessionId] ?? IDLE_PROGRESS).stage !== 'done') {
        setCastingProgressBySession((current) => {
          const progress = current[targetSessionId]
          return progress?.stage === 'summary' ? { ...current, [targetSessionId]: CASTING_PROGRESS.done } : current
        })
      }
    }
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
        <aside className="sidebar">
          <div className="sidebar-head">
            <div>
              <p className="eyebrow">History</p>
              <h2>对话</h2>
            </div>
            <button className="icon-button" type="button" onClick={startNewConversation} aria-label="新对话">
              <MessageSquarePlus size={18} />
            </button>
          </div>

          <ConversationList
            conversations={conversations}
            activeSessionId={sessionId}
            onSelect={selectConversation}
            onDelete={removeConversation}
          />
          {historyError ? <p className="sidebar-error">{historyError}</p> : null}
        </aside>
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />

        <section className="workspace">
          <header className="topbar">
            <button
              className="icon-button"
              type="button"
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
            >
              {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>

            <div className="thread-title">
              <p>{activeTitle}</p>
              <span className="thread-status">
                {pageBusy ? <LoadingSpinner /> : null}
                {historyLoading ? '同步中' : activeWorkflowRunning || isRunning ? activeCastingProgress.label : '就绪'}
                {backgroundTaskCount > 0 ? ` · 后台 ${backgroundTaskCount}` : ''}
              </span>
            </div>

            <div className="account-chip">
              <span>{user.displayName || user.username}</span>
              <button className="icon-button" type="button" onClick={onLogout} aria-label="退出">
                <LogOut size={17} />
              </button>
            </div>
          </header>

          {!activeConversationReady ? (
            <section className="casting-only">
              <DivinationWorkbench
                method={method}
                question={question}
                methodInput={methodInput}
                analysisMode={analysisMode}
                angles={angles}
                running={activeWorkflowRunning}
                progress={activeCastingProgress}
                reading={activeReading}
                activePanel={activePanel}
                onMethodChange={(nextMethod) => {
                  setMethod(nextMethod)
                  setMethodInput('')
                  setWorkflowError('')
                }}
                onQuestionChange={setQuestion}
                onMethodInputChange={setMethodInput}
                onAnalysisModeChange={setAnalysisMode}
                onAnglesChange={setAngles}
                onSubmit={runDivination}
                onPanelChange={setActivePanel}
              />
              {workflowError ? <p className="workflow-error">{workflowError}</p> : null}
            </section>
          ) : (
            <ThreadPrimitive.Root className="thread-root">
              <ThreadPrimitive.Viewport className="thread-viewport">
                <EmptyThread />
                <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
                <DetailBlock panel={activePanel} reading={activeReading} onClose={() => setActivePanel(null)} />
              </ThreadPrimitive.Viewport>
              <div className="composer-footer">
                <ReadingAttachmentPanel
                  reading={activeReading}
                  activePanel={activePanel}
                  onPanelChange={setActivePanel}
                />
                <ComposerPrimitive.Root className="composer">
                  <ComposerPrimitive.Input
                    className="composer-input"
                    placeholder={activeConversationReady ? '继续追问...' : '先在上方完成起卦'}
                    submitMode="enter"
                    rows={1}
                  />
                  <ComposerPrimitive.Send className="send-button" aria-label="发送">
                    <SendHorizontal size={18} />
                  </ComposerPrimitive.Send>
                </ComposerPrimitive.Root>
              </div>
            </ThreadPrimitive.Root>
          )}
        </section>
      </main>
    </AssistantRuntimeProvider>
  )
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem(REFRESH_TOKEN_KEY) ?? '')
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as AuthUser
    } catch {
      return null
    }
  })

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken('')
    setRefreshToken('')
    setUser(null)
  }

  if (!token || !refreshToken || !user) {
    return (
      <LoginScreen
        onLogin={(nextToken, nextRefreshToken, nextUser) => {
          localStorage.setItem(TOKEN_KEY, nextToken)
          localStorage.setItem(REFRESH_TOKEN_KEY, nextRefreshToken)
          localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
          setToken(nextToken)
          setRefreshToken(nextRefreshToken)
          setUser(nextUser)
        }}
      />
    )
  }

  return (
    <AuthedApp
      token={token}
      refreshToken={refreshToken}
      user={user}
      onTokenRefresh={(nextToken, nextRefreshToken) => {
        localStorage.setItem(TOKEN_KEY, nextToken)
        localStorage.setItem(REFRESH_TOKEN_KEY, nextRefreshToken)
        setToken(nextToken)
        setRefreshToken(nextRefreshToken)
      }}
      onLogout={logout}
    />
  )
}

export default App
