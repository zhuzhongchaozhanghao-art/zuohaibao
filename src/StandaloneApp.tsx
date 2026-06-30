import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Download,
  ExternalLink,
  Image,
  Loader2,
  Play,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Unlink,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './StandaloneApp.css'

type GenerateStatus = 'idle' | 'pending' | 'running' | 'done' | 'failed'

type PromptNodeData = {
  title: string
  prompt: string
  onChange: (id: string, patch: Partial<PromptNodeData>) => void
  onOptimize: (id: string) => void
  optimizing: boolean
  [key: string]: unknown
}

type GenerateNodeData = {
  title: string
  providerId?: string
  model: string
  size: string
  ratio?: ImageRatio
  resolution?: ImageResolution
  customWidth?: string
  customHeight?: string
  quality: string
  status: GenerateStatus
  jobId?: string
  error?: string
  providers?: ImageProvider[]
  onChange: (id: string, patch: Partial<GenerateNodeData>) => void
  onRun: (id: string) => void
  [key: string]: unknown
}

type ReferenceImage = {
  id: string
  name: string
  dataUrl: string
}

type ReferenceNodeData = {
  title: string
  images: ReferenceImage[]
  onChange: (id: string, patch: Partial<ReferenceNodeData>) => void
  [key: string]: unknown
}

type ResultNodeData = {
  title: string
  urls: string[]
  items?: ResultItem[]
  mode?: 'replace' | 'append'
  status: GenerateStatus
  error?: string
  onChange?: (id: string, patch: Partial<ResultNodeData>) => void
  onPreview?: (item: ResultItem) => void
  [key: string]: unknown
}

type ResultItem = {
  id: string
  url: string
  status?: 'loading' | 'done' | 'failed'
  sourceNodeId: string
  sourceTitle: string
  prompt?: string
  model: string
  size: string
  quality: string
  jobId: string
  createdAt: string
}

type AppNodeData = PromptNodeData | GenerateNodeData | ReferenceNodeData | ResultNodeData
type AppNode = Node<AppNodeData>

type ApiSettings = {
  imageProviders?: ImageProvider[]
  imageBaseUrl: string
  imageApiKey: string
  imageModel: string
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
}

type ImageProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
}

type JobResponse = {
  jobId: string
  status: GenerateStatus
  resultUrls: string[]
  error?: string
  costUsd?: number
  sizeTier?: string
}

type DirectGenerateInput = {
  provider: ImageProvider
  model: string
  prompt: string
  size: string
  quality: string
  referenceImages: ReferenceImage[]
}

type AppPage = 'home' | 'canvas' | 'simple'

type HomePageProps = {
  onOpenCanvas: () => void
  onOpenSimple: () => void
}

type SimpleGeneratePageProps = {
  settings: ApiSettings
  onOpenHome: () => void
  onOpenCanvas: () => void
  onOpenSettings: () => void
}

type ImageRatio = 'Auto' | '1:1' | '9:16' | '3:4' | '4:3' | '16:9'
type ImageResolution = '1k' | '2k' | '4k' | 'custom'

const maxTotalPixels = 3840 * 2160

const ratioOptions: Array<{
  value: ImageRatio
  label: string
  box?: { width: number; height: number }
}> = [
  { value: 'Auto', label: 'AI 自定' },
  { value: '1:1', label: '1:1 方形', box: { width: 30, height: 30 } },
  { value: '9:16', label: '9:16 竖版', box: { width: 22, height: 38 } },
  { value: '3:4', label: '3:4 详情', box: { width: 28, height: 36 } },
  { value: '4:3', label: '4:3 横版', box: { width: 38, height: 28 } },
  { value: '16:9', label: '16:9 宽屏', box: { width: 42, height: 24 } },
]

const sizePresets: Record<Exclude<ImageRatio, 'Auto'>, Record<Exclude<ImageResolution, 'custom'>, string>> = {
  '1:1': {
    '1k': '1024x1024',
    '2k': '2048x2048',
    '4k': '2880x2880',
  },
  '16:9': {
    '1k': '1024x576',
    '2k': '2048x1152',
    '4k': '3840x2160',
  },
  '9:16': {
    '1k': '576x1024',
    '2k': '1152x2048',
    '4k': '2160x3840',
  },
  '4:3': {
    '1k': '1024x768',
    '2k': '2048x1536',
    '4k': '3312x2496',
  },
  '3:4': {
    '1k': '768x1024',
    '2k': '1536x2048',
    '4k': '2496x3312',
  },
}

const qualityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  auto: '自动',
}

const defaultSettings: ApiSettings = {
  imageProviders: [
    {
      id: 'openai-compatible',
      name: 'OpenAI 兼容',
      baseUrl: '',
      apiKey: '',
      models: ['gpt-image-2'],
    },
  ],
  imageBaseUrl: '',
  imageApiKey: '',
  imageModel: 'gpt-image-2',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: 'gpt-5.4-mini',
}

const settingsStorageKey = 'seal-canvas-settings'
const legacySettingsStorageKey = 'seal-canvas-standalone-settings'

const initialNodes: AppNode[] = [
  {
    id: 'prompt-1',
    type: 'prompt',
    position: { x: -520, y: 20 },
    data: {
      title: '提示词',
      prompt: '',
      onChange: () => undefined,
      onOptimize: () => undefined,
      optimizing: false,
    },
  },
  {
    id: 'reference-1',
    type: 'reference',
    position: { x: -520, y: 360 },
    data: {
      title: '参考图',
      images: [],
      onChange: () => undefined,
    },
  },
  {
    id: 'generate-1',
    type: 'generate',
    position: { x: -70, y: 52 },
      data: {
        title: '生图',
        providerId: 'openai-compatible',
        model: 'gpt-image-2',
      size: '1152x2048',
      ratio: '9:16',
      resolution: '2k',
      customWidth: '1152',
      customHeight: '2048',
      quality: 'high',
      status: 'idle',
      onChange: () => undefined,
      onRun: () => undefined,
    },
  },
  {
    id: 'result-1',
    type: 'result',
    position: { x: 350, y: 10 },
    data: {
      title: '结果',
      urls: [],
      items: [],
      mode: 'append',
      status: 'idle',
    },
  },
]

const initialEdges: Edge[] = [
  createEdge('prompt-1', 'generate-1'),
  createEdge('reference-1', 'generate-1'),
  createEdge('generate-1', 'result-1'),
]

function PromptNode({ id, data }: NodeProps<Node<PromptNodeData>>) {
  const promptLength = data.prompt.length

  return (
    <section className="canvas-node prompt-node">
      <Handle type="source" position={Position.Right} />
      <div className="node-head floating-head align-right">
        <button
          type="button"
          className="icon-button nodrag nowheel"
          title="优化提示词"
          onClick={() => data.onOptimize(id)}
          disabled={data.optimizing}
        >
          {data.optimizing ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
        </button>
      </div>
      <h3 className="node-static-title">{data.title}</h3>
      <textarea
        className="prompt-input nodrag nowheel"
        value={data.prompt}
        maxLength={1000}
        onChange={(event) => data.onChange(id, { prompt: event.target.value })}
        placeholder="描述你想生成的图片"
      />
      <div className={`prompt-count ${promptLength >= 900 ? 'near-limit' : ''}`}>
        {promptLength}/1000
      </div>
    </section>
  )
}

function GenerateNode({ id, data }: NodeProps<Node<GenerateNodeData>>) {
  const running = data.status === 'pending' || data.status === 'running'
  const providers = data.providers?.length ? data.providers : defaultSettings.imageProviders || []
  const selectedProvider = providers.find((provider) => provider.id === data.providerId) || providers[0]
  const providerModels = selectedProvider?.models?.filter(Boolean)?.length
    ? selectedProvider.models.filter(Boolean)
    : [data.model || defaultSettings.imageModel]
  const ratio = data.ratio || ratioFromSize(data.size)
  const resolution = data.resolution || resolutionFromSize(data.size)
  const customWidth = data.customWidth || splitSizeValue(data.size)?.width || defaultCustomSize(ratio, resolution).width
  const customHeight = data.customHeight || splitSizeValue(data.size)?.height || defaultCustomSize(ratio, resolution).height

  const updateRatio = (nextRatio: ImageRatio) => {
    const nextDefaults = defaultCustomSize(nextRatio, resolution)
    data.onChange(id, {
      ratio: nextRatio,
      customWidth: nextDefaults.width,
      customHeight: nextDefaults.height,
      size: sizeForApi({ ...data, ratio: nextRatio, resolution, customWidth: nextDefaults.width, customHeight: nextDefaults.height }),
    })
  }

  const updateResolution = (nextResolution: ImageResolution) => {
    const nextDefaults = defaultCustomSize(ratio, nextResolution)
    data.onChange(id, {
      resolution: nextResolution,
      customWidth: nextResolution === 'custom' ? customWidth : nextDefaults.width,
      customHeight: nextResolution === 'custom' ? customHeight : nextDefaults.height,
      size: sizeForApi({
        ...data,
        ratio,
        resolution: nextResolution,
        customWidth: nextResolution === 'custom' ? customWidth : nextDefaults.width,
        customHeight: nextResolution === 'custom' ? customHeight : nextDefaults.height,
      }),
    })
  }

  const updateCustomSize = (patch: Partial<Pick<GenerateNodeData, 'customWidth' | 'customHeight'>>) => {
    const nextWidth = patch.customWidth ?? customWidth
    const nextHeight = patch.customHeight ?? customHeight
    data.onChange(id, {
      ...patch,
      resolution: 'custom',
      size: sizeForApi({ ...data, ratio, resolution: 'custom', customWidth: nextWidth, customHeight: nextHeight }),
    })
  }

  const updateProvider = (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId)
    data.onChange(id, {
      providerId,
      model: provider?.models?.[0] || data.model,
    })
  }

  return (
    <section className="canvas-node generate-node">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="node-head generate-head">
        <span className="generate-title">生图</span>
        <span className={`status-pill ${data.status}`}>{statusText(data.status)}</span>
      </div>
      <div className="compact-field">
        <select
          className="nodrag nowheel"
          value={selectedProvider?.id || ''}
          onChange={(event) => updateProvider(event.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>
      <div className="compact-field">
        <select
          className="nodrag nowheel"
          value={data.model}
          onChange={(event) => data.onChange(id, { model: event.target.value })}
        >
          {providerModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>
      <div className="ratio-grid">
        {ratioOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`ratio-option nodrag nowheel ${ratio === option.value ? 'selected' : ''}`}
            onClick={() => updateRatio(option.value)}
          >
            <span className="ratio-frame-mini">
              {option.box ? (
                <span
                  className="ratio-box-mini"
                  style={{ width: option.box.width, height: option.box.height }}
                />
              ) : (
                <span className="auto-box-mini">AUTO</span>
              )}
            </span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      <div className="resolution-row">
        {(['1k', '2k', '4k', 'custom'] as ImageResolution[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`resolution-option nodrag nowheel ${resolution === option ? 'selected' : ''}`}
            onClick={() => updateResolution(option)}
          >
            {option === 'custom' ? '自定义' : option.toUpperCase()}
          </button>
        ))}
      </div>
      {resolution === 'custom' ? (
        <div className="custom-size-panel compact">
          <div className="custom-size-fields">
            <div className="custom-size-field">
              <input
                className="nodrag nowheel"
                type="number"
                inputMode="numeric"
                min={64}
                max={8192}
                value={customWidth}
                placeholder="宽度"
                onChange={(event) => updateCustomSize({ customWidth: event.target.value })}
              />
            </div>
            <span className="custom-size-separator">x</span>
            <div className="custom-size-field">
              <input
                className="nodrag nowheel"
                type="number"
                inputMode="numeric"
                min={64}
                max={8192}
                value={customHeight}
                placeholder="高度"
                onChange={(event) => updateCustomSize({ customHeight: event.target.value })}
              />
            </div>
          </div>
        </div>
      ) : null}
      <div className="quality-row">
        {(['low', 'medium', 'high', 'auto'] as const).map((quality) => (
          <button
            key={quality}
            type="button"
            className={`quality-option nodrag nowheel ${data.quality === quality ? 'selected' : ''}`}
            onClick={() => data.onChange(id, { quality })}
          >
            {qualityLabels[quality]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="primary-button nodrag nowheel"
        onClick={() => data.onRun(id)}
        disabled={running}
      >
        {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
        生成图片
      </button>
      {data.jobId ? <p className="meta-line">Job: {data.jobId}</p> : null}
      {data.error ? <p className="error-line">{data.error}</p> : null}
    </section>
  )
}

function ReferenceNode({ id, data }: NodeProps<Node<ReferenceNodeData>>) {
  const [draggingImageId, setDraggingImageId] = useState('')
  const [isUploadDragging, setIsUploadDragging] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const images = await Promise.all(
      Array.from(files)
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, 10)
        .map(async (file) => ({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          dataUrl: await readFileAsDataUrl(file),
        })),
    )
    data.onChange(id, { images: [...data.images, ...images].slice(0, 10) })
  }

  const removeImage = (imageId: string) => {
    data.onChange(id, { images: data.images.filter((image) => image.id !== imageId) })
  }

  const moveImage = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return
    const fromIndex = data.images.findIndex((image) => image.id === fromId)
    const toIndex = data.images.findIndex((image) => image.id === toId)
    if (fromIndex < 0 || toIndex < 0) return

    const nextImages = [...data.images]
    const [movedImage] = nextImages.splice(fromIndex, 1)
    nextImages.splice(toIndex, 0, movedImage)
    data.onChange(id, { images: nextImages })
  }

  return (
    <section className="canvas-node reference-node">
      <Handle type="source" position={Position.Right} />
      <div className="node-head floating-head align-right">
        <span className="status-pill">{data.images.length}/10</span>
      </div>
      <h3 className="node-static-title">{data.title}</h3>
      <label
        className={`upload-zone nodrag nowheel ${isUploadDragging ? 'dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault()
          setIsUploadDragging(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setIsUploadDragging(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setIsUploadDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsUploadDragging(false)
          handleFiles(event.dataTransfer.files)
        }}
      >
        <Image size={30} strokeWidth={1.8} />
        <span>上传参考图</span>
        <input
          className="nodrag nowheel"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => handleFiles(event.target.files)}
        />
      </label>
      {data.images.length > 0 ? (
        <div className="reference-grid">
          {data.images.map((image, index) => (
            <figure
              key={image.id}
              className={`reference-thumb nodrag nowheel ${draggingImageId === image.id ? 'dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                setDraggingImageId(image.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', image.id)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDragEnter={(event) => {
                event.preventDefault()
                moveImage(draggingImageId || event.dataTransfer.getData('text/plain'), image.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                moveImage(event.dataTransfer.getData('text/plain'), image.id)
                setDraggingImageId('')
              }}
              onDragEnd={() => setDraggingImageId('')}
              title="拖动排序"
            >
              <img src={image.dataUrl} alt={image.name} />
              <span className="thumb-index">{index + 1}</span>
              <button
                type="button"
                className="mini-delete nodrag nowheel"
                title="移除参考图"
                onClick={() => removeImage(image.id)}
              >
                <Trash2 size={13} />
              </button>
            </figure>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ResultNode({ id, data }: NodeProps<Node<ResultNodeData>>) {
  const items = resultItemsFromData(data)
  const mode = data.mode || 'append'

  return (
    <section className="canvas-node result-node">
      <Handle type="target" position={Position.Left} />
      <div className="result-title-row">
        <div className="result-title-main">
          <h3>{data.title}</h3>
          <span className={`status-pill ${data.status}`}>{statusText(data.status)}</span>
        </div>
        <div className="result-mode-toggle">
          <button
            type="button"
            className={`nodrag nowheel ${mode === 'append' ? 'active' : ''}`}
            onClick={() => data.onChange?.(id, { mode: 'append' })}
          >
            追加
          </button>
          <button
            type="button"
            className={`nodrag nowheel ${mode === 'replace' ? 'active' : ''}`}
            onClick={() => data.onChange?.(id, { mode: 'replace' })}
          >
            覆盖
          </button>
        </div>
      </div>
      <div className="result-frame">
        {(data.status === 'pending' || data.status === 'running') && items.length === 0 ? (
          <div className="empty-result">
            <Loader2 className="spin" size={28} />
          </div>
        ) : items.length > 0 ? (
          <div className="image-stack">
            {items.map((item, index) => (
              <figure key={item.id} className={item.status === 'loading' ? 'loading-card' : ''}>
                {item.status === 'loading' ? (
                  <div className="result-loading-tile">
                    <Loader2 className="spin" size={24} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="result-preview-button nodrag nowheel"
                    onClick={() => data.onPreview?.(item)}
                    title="大图预览"
                  >
                    <img src={item.url} alt="生成结果" />
                  </button>
                )}
                <figcaption>
                  <span>{index + 1}. {item.sourceTitle}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="empty-result">
            <Image size={34} />
          </div>
        )}
      </div>
      {data.error ? <p className="error-line">{data.error}</p> : null}
    </section>
  )
}

const nodeTypes = {
  prompt: PromptNode,
  reference: ReferenceNode,
  generate: GenerateNode,
  result: ResultNode,
}

function pageFromPath(): AppPage {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/canvas') return 'canvas'
  if (path === '/generate') return 'simple'
  return 'home'
}

function navigateToPath(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
}

function App() {
  const [activePage, setActivePage] = useState<AppPage>(() => pageFromPath())
  const [nodes, setNodes] = useState<AppNode[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [settings, setSettings] = useState<ApiSettings>(() => loadStandaloneSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [optimizingNodeId, setOptimizingNodeId] = useState('')
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [previewItem, setPreviewItem] = useState<ResultItem | null>(null)
  const imageProviders = useMemo(() => normalizeImageProviders(settings), [settings])
  const editableImageProviders = useMemo(() => editableProviders(settings), [settings])
  const [isSavingProject, setIsSavingProject] = useState(false)
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    screenX: number
    screenY: number
    flowX: number
    flowY: number
  } | null>(null)
  const [cutTrail, setCutTrail] = useState<Array<{ x: number; y: number }>>([])
  const cutEdgeIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!saveMessage && !globalError) return
    const timer = window.setTimeout(() => {
      setSaveMessage('')
      setGlobalError('')
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [globalError, saveMessage])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    if (activePage === 'home') return
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activePage])

  useEffect(() => {
    const handlePopState = () => {
      setActivePage(pageFromPath())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const updateNodeData = useCallback((id: string, patch: Partial<AppNodeData>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...patch } as AppNodeData } : node,
      ),
    )
  }, [])

  const updateNodesData = useCallback((ids: string[], patch: Partial<AppNodeData>) => {
    if (ids.length === 0) return
    setNodes((current) =>
      current.map((node) =>
        ids.includes(node.id) ? { ...node, data: { ...node.data, ...patch } as AppNodeData } : node,
      ),
    )
  }, [])

  const ensureResultTargets = useCallback(
    (generateId: string) => {
      const downstreamResultIds = edges
        .filter((edge) => edge.source === generateId)
        .map((edge) => edge.target)
        .filter((targetId) => nodes.some((node) => node.id === targetId && node.type === 'result'))

      if (downstreamResultIds.length > 0) return downstreamResultIds

      const sourceNode = nodes.find((node) => node.id === generateId)
      const resultId = `result-${Date.now()}`
      const position = {
        x: (sourceNode?.position.x || 0) + 430,
        y: sourceNode?.position.y || 0,
      }

      setNodes((current) => [
        ...current,
        {
          id: resultId,
          type: 'result',
          position,
          data: {
            title: '结果',
            urls: [],
            items: [],
            mode: 'append',
            status: 'idle',
          },
        },
      ])
      setEdges((current) => [...current, createEdge(generateId, resultId)])

      return [resultId]
    },
    [edges, nodes],
  )

  const updateResultsForStart = useCallback((ids: string[], generateId: string, generateData: GenerateNodeData, outputSize: string, prompt: string) => {
    if (ids.length === 0) return
    const loadingItem: ResultItem = {
      id: `loading-${generateId}-${Date.now()}`,
      url: '',
      status: 'loading',
      sourceNodeId: generateId,
      sourceTitle: `${generateData.model || '生图'} · ${generateId.slice(-4)}`,
      model: generateData.model,
      size: outputSize,
      quality: generateData.quality,
      prompt,
      jobId: '',
      createdAt: new Date().toISOString(),
    }
    setNodes((current) =>
      current.map((node) => {
        if (!ids.includes(node.id) || node.type !== 'result') return node
        const data = normalizeResultData(node.data as ResultNodeData)
        const shouldClear = data.mode === 'replace'
        const items = shouldClear
          ? [loadingItem]
          : [...(data.items || []).filter((item) => !(item.status === 'loading' && item.sourceNodeId === generateId)), loadingItem]
        return {
          ...node,
          data: {
            ...data,
            status: 'pending',
            error: '',
            urls: items.filter((item) => item.status !== 'loading').map((item) => item.url),
            items,
          },
        }
      }),
    )
  }, [])

  const updateResultsForCompletion = useCallback(
    (
      ids: string[],
      job: JobResponse,
      generateId: string,
      generateData: GenerateNodeData,
      outputSize: string,
      prompt: string,
    ) => {
      if (ids.length === 0) return
      const createdAt = new Date().toISOString()
      const newItems = job.resultUrls.map((url, index) => ({
        id: `${job.jobId}-${index}-${Date.now()}`,
        url,
        sourceNodeId: generateId,
        sourceTitle: `${generateData.model || '生图'} · ${generateId.slice(-4)}`,
        prompt,
        model: generateData.model,
        size: outputSize,
        quality: generateData.quality,
        jobId: job.jobId,
        createdAt,
      }))

      setNodes((current) =>
        current.map((node) => {
          if (!ids.includes(node.id) || node.type !== 'result') return node
          const data = normalizeResultData(node.data as ResultNodeData)
          const existingItems = (data.items || []).filter(
            (item) => !(item.status === 'loading' && item.sourceNodeId === generateId),
          )
          const items = data.mode === 'replace' ? newItems : [...existingItems, ...newItems]
          return {
            ...node,
            data: {
              ...data,
              status: job.status,
              error: job.error,
              items,
              urls: items.map((item) => item.url),
            },
          }
        }),
      )
    },
    [],
  )

  const updateResultsForFailure = useCallback((ids: string[], generateId: string, message: string) => {
    if (ids.length === 0) return
    setNodes((current) =>
      current.map((node) => {
        if (!ids.includes(node.id) || node.type !== 'result') return node
        const data = normalizeResultData(node.data as ResultNodeData)
        const items = (data.items || []).filter(
          (item) => !(item.status === 'loading' && item.sourceNodeId === generateId),
        )
        return {
          ...node,
          data: {
            ...data,
            status: 'failed',
            error: message,
            items,
            urls: items.filter((item) => item.status !== 'loading').map((item) => item.url),
          },
        }
      }),
    )
  }, [])

  const getNode = useCallback(
    <T extends AppNodeData,>(id: string) => nodes.find((node) => node.id === id)?.data as T | undefined,
    [nodes],
  )

  const runGenerate = useCallback(
    async (generateId: string) => {
      setGlobalError('')
      const generateData = getNode<GenerateNodeData>(generateId)
      if (!generateData) return
      const imageProvider = providerForGenerate(generateData, imageProviders)
      const workflowInput = collectGenerateInput(generateId, nodes, edges)
      const outputSize = sizeForApi(generateData)

      if (!workflowInput.prompt.trim()) {
        updateNodeData(generateId, { error: '请先填写提示词。' })
        return
      }

      if (!outputSize) {
        updateNodeData(generateId, { error: '请检查自定义分辨率，宽高需为 64-8192 且总像素不超过 829 万。' })
        return
      }

      const resultIds = ensureResultTargets(generateId)

      updateNodeData(generateId, { status: 'pending', error: '', jobId: '' })
      updateResultsForStart(resultIds, generateId, generateData, outputSize, workflowInput.prompt)

      try {
        const finalJob = await directGenerateImage({
          provider: imageProvider,
          model: generateData.model || imageProvider.models[0] || settings.imageModel,
          prompt: workflowInput.prompt,
          size: outputSize,
          quality: generateData.quality,
          referenceImages: workflowInput.referenceImages,
        })
        updateNodeData(generateId, { status: finalJob.status, jobId: finalJob.jobId || '' })
        updateNodesData(resultIds, { status: finalJob.status })
        updateNodeData(generateId, {
          status: finalJob.status,
          error: finalJob.error,
        })
        updateResultsForCompletion(resultIds, finalJob, generateId, generateData, outputSize, workflowInput.prompt)
      } catch (error) {
        const message = error instanceof Error ? error.message : '生成失败'
        updateNodeData(generateId, { status: 'failed', error: message })
        updateResultsForFailure(resultIds, generateId, message)
      }
    },
    [
      edges,
      ensureResultTargets,
      getNode,
      imageProviders,
      nodes,
      settings.imageModel,
      updateNodeData,
      updateNodesData,
      updateResultsForCompletion,
      updateResultsForFailure,
      updateResultsForStart,
    ],
  )

  const optimizePrompt = useCallback(
    async (promptId: string) => {
      const promptData = getNode<PromptNodeData>(promptId)
      if (!promptData?.prompt.trim()) return

      setOptimizingNodeId(promptId)
      setGlobalError('')

      try {
        const prompt = await directOptimizePrompt(settings, promptData.prompt)
        updateNodeData(promptId, { prompt })
      } catch (error) {
        const message = error instanceof Error ? error.message : '提示词优化失败'
        setGlobalError(message)
      } finally {
        setOptimizingNodeId('')
      }
    },
    [getNode, settings, updateNodeData],
  )

  const hydratedNodes = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type === 'prompt') {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: updateNodeData,
              onOptimize: optimizePrompt,
              optimizing: optimizingNodeId === node.id,
            },
          }
        }
        if (node.type === 'generate') {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: updateNodeData,
              onRun: runGenerate,
              providers: imageProviders,
            },
          }
        }
        if (node.type === 'reference') {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: updateNodeData,
            },
          }
        }
        if (node.type === 'result') {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: updateNodeData,
              onPreview: setPreviewItem,
            },
          }
        }
        return node
      }),
    [imageProviders, nodes, optimizingNodeId, optimizePrompt, runGenerate, updateNodeData],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current) as AppNode[]),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  )
  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge(createEdge(connection.source, connection.target), current)),
    [],
  )

  const onSelectionChange = useCallback((selection: OnSelectionChangeParams) => {
    setSelectedNodeIds(selection.nodes.map((node) => node.id))
    setSelectedEdgeIds(selection.edges.map((edge) => edge.id))
  }, [])

  const onPaneClick = useCallback(() => {
    setContextMenu(null)
  }, [])

  const addNodeAtPosition = useCallback(
    (type: 'prompt' | 'reference' | 'generate' | 'result', flowX: number, flowY: number) => {
      const id = `${type}-${Date.now()}`
      if (type === 'prompt') {
        setNodes((current) => [
          ...current,
          {
            id,
            type: 'prompt',
            position: { x: flowX, y: flowY },
            data: { title: '提示词', prompt: '', onChange: updateNodeData, onOptimize: optimizePrompt, optimizing: false },
          },
        ])
      } else if (type === 'reference') {
        setNodes((current) => [
          ...current,
          {
            id,
            type: 'reference',
            position: { x: flowX, y: flowY },
            data: { title: '参考图', images: [], onChange: updateNodeData },
          },
        ])
      } else if (type === 'generate') {
        const provider = imageProviders[0]
        setNodes((current) => [
          ...current,
          {
            id,
            type: 'generate',
            position: { x: flowX, y: flowY },
            data: {
              title: '生图',
              providerId: provider?.id,
              model: provider?.models?.[0] || settings.imageModel,
              size: '1152x2048',
              ratio: '9:16',
              resolution: '2k',
              customWidth: '1152',
              customHeight: '2048',
              quality: 'high',
              status: 'idle',
              onChange: updateNodeData,
              onRun: runGenerate,
            },
          },
        ])
      } else {
        setNodes((current) => [
          ...current,
          {
            id,
            type: 'result',
            position: { x: flowX, y: flowY },
            data: { title: '结果', urls: [], items: [], mode: 'append', status: 'idle' },
          },
        ])
      }
      setContextMenu(null)
    },
    [imageProviders, optimizePrompt, runGenerate, settings.imageModel, updateNodeData],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const target = e.target as HTMLElement
      if (
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__handle') ||
        target.closest('.react-flow__controls') ||
        target.closest('.react-flow__minimap')
      ) {
        return
      }
      if (!rfInstance) return
      const flowPos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, flowX: flowPos.x, flowY: flowPos.y })
    },
    [rfInstance],
  )

  const startCutGesture = useCallback((clientX: number, clientY: number) => {
    setCutTrail([{ x: clientX, y: clientY }])
    cutEdgeIdsRef.current = new Set()

    const handleMove = (e: MouseEvent) => {
      setCutTrail((prev) => [...prev, { x: e.clientX, y: e.clientY }])
      const elements = document.elementsFromPoint(e.clientX, e.clientY)
      for (const el of elements) {
        const edgeEl = el.closest('.react-flow__edge')
        if (edgeEl) {
          const edgeId = edgeEl.getAttribute('data-id')
          if (edgeId && !cutEdgeIdsRef.current.has(edgeId)) {
            cutEdgeIdsRef.current.add(edgeId)
            edgeEl.classList.add('being-cut')
          }
        }
      }
    }

    const handleUp = () => {
      const idsToDelete = new Set(cutEdgeIdsRef.current)
      if (idsToDelete.size > 0) {
        setEdges((current) => current.filter((edge) => !idsToDelete.has(edge.id)))
      }
      document.querySelectorAll('.react-flow__edge.being-cut').forEach((el) => el.classList.remove('being-cut'))
      setCutTrail([])
      cutEdgeIdsRef.current = new Set()
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [])

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__handle') ||
        target.closest('.react-flow__controls') ||
        target.closest('.react-flow__minimap') ||
        target.closest('.canvas-context-menu')
      ) {
        return
      }
      setContextMenu(null)
      startCutGesture(e.clientX, e.clientY)
    },
    [startCutGesture],
  )

  useEffect(() => {
    if (!contextMenu) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenu])

  useEffect(() => {
    if (activePage !== 'canvas') return
    const handlePaste = async (e: ClipboardEvent) => {
      const active = document.activeElement
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable)
      ) {
        return
      }
      const items = e.clipboardData?.items
      if (!items) return
      const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'))
      if (imageItems.length === 0) return
      e.preventDefault()
      const images: ReferenceImage[] = []
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (!file) continue
        const dataUrl = await readFileAsDataUrl(file)
        images.push({
          id: `pasted-${Date.now()}-${crypto.randomUUID()}`,
          name: file.name || 'pasted-image',
          dataUrl,
        })
      }
      if (images.length === 0) return
      const centerX = window.innerWidth / 2
      const centerY = (68 + window.innerHeight) / 2
      const flowPos = rfInstance?.screenToFlowPosition({ x: centerX, y: centerY }) || { x: 0, y: 0 }
      const id = `reference-${Date.now()}`
      setNodes((current) => [
        ...current,
        {
          id,
          type: 'reference',
          position: flowPos,
          data: { title: '参考图', images, onChange: updateNodeData },
        },
      ])
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [activePage, rfInstance, updateNodeData])

  const addPromptNode = () => {
    const id = `prompt-${Date.now()}`
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'prompt',
        position: { x: -560 + current.length * 24, y: 300 + current.length * 18 },
        data: {
          title: '提示词',
          prompt: '',
          onChange: updateNodeData,
          onOptimize: optimizePrompt,
          optimizing: false,
        },
      },
    ])
  }

  const addReferenceNode = () => {
    const id = `reference-${Date.now()}`
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'reference',
        position: { x: -560 + current.length * 24, y: 300 + current.length * 18 },
        data: {
          title: '参考图',
          images: [],
          onChange: updateNodeData,
        },
      },
    ])
  }

  const addGenerateNode = () => {
    const id = `generate-${Date.now()}`
    const provider = imageProviders[0]
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'generate',
        position: { x: -80 + current.length * 24, y: 280 + current.length * 18 },
        data: {
          title: '生图',
          providerId: provider?.id,
          model: provider?.models?.[0] || settings.imageModel,
          size: '1152x2048',
          ratio: '9:16',
          resolution: '2k',
          customWidth: '1152',
          customHeight: '2048',
          quality: 'high',
          status: 'idle',
          onChange: updateNodeData,
          onRun: runGenerate,
        },
      },
    ])
  }

  const addResultNode = () => {
    const id = `result-${Date.now()}`
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'result',
        position: { x: 360 + current.length * 24, y: 260 + current.length * 18 },
        data: {
          title: '结果',
          urls: [],
          items: [],
          mode: 'append',
          status: 'idle',
        },
      },
    ])
  }

  const deleteSelection = () => {
    setNodes((current) => current.filter((node) => !selectedNodeIds.includes(node.id)))
    setEdges((current) =>
      current.filter(
        (edge) =>
          !selectedEdgeIds.includes(edge.id) &&
          !selectedNodeIds.includes(edge.source) &&
          !selectedNodeIds.includes(edge.target),
      ),
    )
    setSelectedNodeIds([])
    setSelectedEdgeIds([])
  }

  const disconnectSelection = () => {
    setEdges((current) =>
      current.filter(
        (edge) =>
          !selectedEdgeIds.includes(edge.id) &&
          !selectedNodeIds.includes(edge.source) &&
          !selectedNodeIds.includes(edge.target),
      ),
    )
    setSelectedEdgeIds([])
  }

  const updateImageProvider = (providerId: string, patch: Partial<ImageProvider>) => {
    setSettings((current) => ({
      ...current,
      imageProviders: editableProviders(current).map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      ),
    }))
  }

  const updateProviderModel = (providerId: string, modelIndex: number, model: string) => {
    const provider = editableImageProviders.find((item) => item.id === providerId)
    if (!provider) return
    const models = provider.models.map((item, index) => (index === modelIndex ? model : item)).filter(Boolean)
    updateImageProvider(providerId, { models })
  }

  const addProviderModel = (providerId: string) => {
    const provider = editableImageProviders.find((item) => item.id === providerId)
    if (!provider) return
    updateImageProvider(providerId, { models: [...provider.models, ''] })
  }

  const removeProviderModel = (providerId: string, modelIndex: number) => {
    const provider = editableImageProviders.find((item) => item.id === providerId)
    if (!provider) return
    const models = provider.models.filter((_, index) => index !== modelIndex)
    updateImageProvider(providerId, { models: models.length ? models : [defaultSettings.imageModel] })
  }

  const addImageProvider = () => {
    const id = `image-provider-${Date.now()}`
    setSettings((current) => ({
      ...current,
      imageProviders: [
        ...editableProviders(current),
        {
          id,
          name: `接口 ${editableProviders(current).length + 1}`,
          baseUrl: '',
          apiKey: '',
          models: [defaultSettings.imageModel],
        },
      ],
    }))
  }

  const removeImageProvider = (providerId: string) => {
    setSettings((current) => {
      const providers = editableProviders(current)
      if (providers.length <= 1) return current
      return {
        ...current,
        imageProviders: providers.filter((provider) => provider.id !== providerId),
      }
    })
    setNodes((current) =>
      current.map((node) => {
        if (node.type !== 'generate') return node
        const data = node.data as GenerateNodeData
        if (data.providerId !== providerId) return node
        const fallbackProvider = imageProviders.find((provider) => provider.id !== providerId) || imageProviders[0]
        return {
          ...node,
          data: {
            ...data,
            providerId: fallbackProvider?.id,
            model: fallbackProvider?.models?.[0] || data.model,
          },
        }
      }),
    )
  }

  const persistSettings = async () => {
    setGlobalError('')
    setSaveMessage('')
    setIsSavingProject(true)

    try {
      saveStandaloneSettings(privateSettings(settings))
      setSaveMessage(`设置已保存 ${new Date().toLocaleTimeString()}`)
      window.setTimeout(() => setSaveMessage(''), 2500)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存设置失败'
      setGlobalError(message)
    } finally {
      setIsSavingProject(false)
    }
  }

  const saveSettings = () => persistSettings()

  const openCanvasPage = () => {
    navigateToPath('/canvas')
    setActivePage('canvas')
  }

  const openSimplePage = () => {
    navigateToPath('/generate')
    setSettingsOpen(false)
    setActivePage('simple')
  }

  const openHomePage = () => {
    navigateToPath('/')
    setSettingsOpen(false)
    setActivePage('home')
  }

  const openSettingsFromSimplePage = () => {
    navigateToPath('/canvas')
    setActivePage('canvas')
    setSettingsOpen(true)
  }

  if (activePage === 'home') {
    return <HomePage onOpenCanvas={openCanvasPage} onOpenSimple={openSimplePage} />
  }

  if (activePage === 'simple') {
    return (
      <SimpleGeneratePage
        settings={settings}
        onOpenHome={openHomePage}
        onOpenCanvas={openCanvasPage}
        onOpenSettings={openSettingsFromSimplePage}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand-mark">海</span>
          <div>
            <h1>海豹画布</h1>
            <p>无限画布图片生成工作流</p>
          </div>
        </div>
        <nav>
          <button type="button" className="toolbar-button" onClick={openHomePage} title="返回首页">
            首页
          </button>
          <button type="button" className="toolbar-button" onClick={addPromptNode} title="新增提示词节点">
            <Plus size={17} />
            提示词
          </button>
          <button type="button" className="toolbar-button" onClick={addReferenceNode} title="新增参考图节点">
            <Image size={17} />
            参考图
          </button>
          <button type="button" className="toolbar-button" onClick={addGenerateNode} title="新增生图节点">
            <Sparkles size={17} />
            生图
          </button>
          <button type="button" className="toolbar-button" onClick={addResultNode} title="新增结果节点">
            <Download size={17} />
            结果
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={disconnectSelection}
            title="断开选中节点相关连线，或删除选中连线"
            disabled={selectedNodeIds.length + selectedEdgeIds.length === 0}
          >
            <Unlink size={17} />
            断开
          </button>
          <button
            type="button"
            className="toolbar-button danger"
            onClick={deleteSelection}
            title="删除选中节点或连线"
            disabled={selectedNodeIds.length + selectedEdgeIds.length === 0}
          >
            <Trash2 size={17} />
            删除
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => setSettingsOpen((value) => !value)}
            title="设置"
          >
            <Settings size={17} />
            设置
          </button>
          <button type="button" className="toolbar-button" onClick={openSimplePage} title="打开普通生图页面">
            <Sparkles size={17} />
            海豹生图
          </button>
        </nav>
      </header>

      <section className="workspace">
        {saveMessage || globalError ? (
          <div className={`save-toast ${globalError ? 'failed' : ''}`} role="status">
            {globalError || saveMessage}
          </div>
        ) : null}
        <div className="canvas-wrapper" onMouseDown={handleCanvasMouseDown} onContextMenu={handleContextMenu}>
        <ReactFlow
          nodes={hydratedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onPaneClick={onPaneClick}
          onInit={setRfInstance}
          panOnDrag={[1]}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#c9d2d6" gap={22} size={1.1} variant={BackgroundVariant.Dots} />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={3} />
          <Panel position="top-left" className="canvas-help">
            <Sparkles size={16} />
            左键拖动节点 | 左键划线断开连线 | 右键添加节点 | 中键移动画布 | Ctrl+V 粘贴图片做参考图
          </Panel>
        </ReactFlow>

        {cutTrail.length > 1 && (
          <svg className="cut-trail-overlay">
            <polyline
              points={cutTrail.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#e5484d"
              strokeWidth={2.5}
              strokeDasharray="6,4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {contextMenu && (
          <div
            className="canvas-context-menu nodrag nowheel"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          >
            <div className="context-menu-title">添加节点</div>
            <button type="button" className="context-menu-option" onClick={() => addNodeAtPosition('prompt', contextMenu.flowX, contextMenu.flowY)}>
              提示词
            </button>
            <button type="button" className="context-menu-option" onClick={() => addNodeAtPosition('reference', contextMenu.flowX, contextMenu.flowY)}>
              参考图
            </button>
            <button type="button" className="context-menu-option" onClick={() => addNodeAtPosition('generate', contextMenu.flowX, contextMenu.flowY)}>
              生图
            </button>
            <button type="button" className="context-menu-option" onClick={() => addNodeAtPosition('result', contextMenu.flowX, contextMenu.flowY)}>
              结果
            </button>
          </div>
        )}
        </div>

        {settingsOpen ? (
          <aside className="settings-panel">
            <h2>模型设置</h2>
            <p>设置保存在当前浏览器 localStorage，生图时从浏览器直连接口。</p>
            <div className="settings-section-head">
              <span>生图接口</span>
              <button type="button" className="mini-text-button" onClick={addImageProvider}>
                新增
              </button>
            </div>
            <div className="provider-list">
              {editableImageProviders.map((provider) => (
                <section className="provider-card" key={provider.id}>
                  <div className="provider-card-head">
                    <input
                      value={provider.name}
                      onChange={(event) => updateImageProvider(provider.id, { name: event.target.value })}
                      placeholder="接口名称"
                    />
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => removeImageProvider(provider.id)}
                      disabled={editableImageProviders.length <= 1}
                      title="删除接口"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <label>
                    <span>API 地址</span>
                    <input
                      value={provider.baseUrl}
                      onChange={(event) => updateImageProvider(provider.id, { baseUrl: event.target.value })}
                      placeholder="https://api.openai.com"
                    />
                  </label>
                  <label>
                    <span>API Key</span>
                    <input
                      type="password"
                      value={provider.apiKey}
                      onChange={(event) => updateImageProvider(provider.id, { apiKey: event.target.value })}
                    />
                  </label>
                  <div className="model-list-head">
                    <span>模型列表</span>
                    <button type="button" className="mini-text-button" onClick={() => addProviderModel(provider.id)}>
                      添加模型
                    </button>
                  </div>
                  <div className="model-list">
                    {provider.models.map((model, modelIndex) => (
                      <div className="model-row" key={`${provider.id}-${modelIndex}`}>
                        <input
                          value={model}
                          onChange={(event) => updateProviderModel(provider.id, modelIndex, event.target.value)}
                          placeholder="模型名称"
                        />
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={() => removeProviderModel(provider.id, modelIndex)}
                          title="删除模型"
                          disabled={provider.models.length <= 1}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="panel-divider" />
            <label>
              <span>LLM API 地址</span>
              <input
                value={settings.llmBaseUrl}
                onChange={(event) => setSettings({ ...settings, llmBaseUrl: event.target.value })}
                placeholder="https://api.openai.com"
              />
            </label>
            <label>
              <span>LLM API Key</span>
              <input
                type="password"
                value={settings.llmApiKey}
                onChange={(event) => setSettings({ ...settings, llmApiKey: event.target.value })}
              />
            </label>
            <label>
              <span>LLM 模型</span>
              <input
                value={settings.llmModel}
                onChange={(event) => setSettings({ ...settings, llmModel: event.target.value })}
              />
            </label>
            <button type="button" className="settings-save-button" onClick={saveSettings} disabled={isSavingProject}>
              {isSavingProject ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
              {isSavingProject ? '保存中' : '保存设置'}
            </button>
          </aside>
        ) : null}

        {previewItem ? (
          <div className="preview-modal" role="dialog" aria-modal="true" onClick={() => setPreviewItem(null)}>
            <div className="preview-content" onClick={(event) => event.stopPropagation()}>
              <div className="preview-head">
                <div>
                  <h2>{previewItem.sourceTitle}</h2>
                  <p>{previewItem.model} · {previewItem.size} · {previewItem.quality}</p>
                </div>
                <div className="preview-actions">
                  <a href={previewItem.url} target="_blank" rel="noreferrer" title="打开原图">
                    <ExternalLink size={17} />
                  </a>
                  <button type="button" onClick={() => downloadImage(previewItem.url, previewItem)} title="下载图片">
                    <Download size={17} />
                  </button>
                  <button type="button" onClick={() => setPreviewItem(null)} title="关闭预览">
                    <X size={18} />
                  </button>
                </div>
              </div>
              <img src={previewItem.url} alt="生成结果大图" />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

function HomePage({ onOpenCanvas, onOpenSimple }: HomePageProps) {
  return (
    <main className="home-page">
      <header className="home-topbar">
        <div className="simple-brand">
          <span className="brand-mark">海</span>
          <div>
            <h1>海豹画布</h1>
            <p>AI 图片生成工作流</p>
          </div>
        </div>
        <nav>
          <button type="button" className="toolbar-button" onClick={onOpenCanvas}>
            无限画布
          </button>
          <button type="button" className="toolbar-button" onClick={onOpenSimple}>
            海豹生图
          </button>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-copy">
          <p className="home-kicker">纯静态 · 浏览器直连 · OpenAI 兼容接口</p>
          <h2>海豹画布</h2>
          <p>
            一个面向图片生成的轻量工作台。你可以用无限画布组织提示词、参考图、生图节点和结果节点，
            也可以用普通页面快速完成一次图片生成。
          </p>
          <div className="home-actions">
            <button type="button" className="home-primary" onClick={onOpenCanvas}>
              在线使用无限画布
            </button>
            <button type="button" className="home-secondary" onClick={onOpenSimple}>
              在线使用海豹生图
            </button>
          </div>
        </div>

        <div className="home-preview" aria-hidden="true">
          <div className="home-node prompt">
            <span>提示词</span>
            <strong>描述画面、文字、风格</strong>
          </div>
          <div className="home-node reference">
            <span>参考图</span>
            <strong>上传、排序、复用</strong>
          </div>
          <div className="home-node generate">
            <span>生图</span>
            <strong>接口 · 模型 · 尺寸</strong>
          </div>
          <div className="home-node result">
            <span>结果</span>
            <strong>预览与下载</strong>
          </div>
          <i className="home-line one" />
          <i className="home-line two" />
          <i className="home-line three" />
        </div>
      </section>

      <section className="home-feature-grid">
        <article>
          <h3>无限画布</h3>
          <p>适合多提示词、多参考图、多模型组合生成。节点可自由连接，结果可以汇总到同一个结果节点。</p>
        </article>
        <article>
          <h3>海豹生图</h3>
          <p>适合快速完成单次生成。按规格、参考图、描述、结果四步操作，简单直接。</p>
        </article>
        <article>
          <h3>纯静态部署</h3>
          <p>没有后端和数据库，构建后上传 dist 目录即可部署。API Key 仅保存在用户浏览器本地。</p>
        </article>
      </section>

      <footer className="home-footer">
        <span>作者：梦迟</span>
        <nav>
          <a href="https://gitee.com/dindoor/zuohaibao" target="_blank" rel="noreferrer">
            Gitee
          </a>
          <a href="https://github.com/hotlt/zuohaibao" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </footer>
    </main>
  )
}

function SimpleGeneratePage({ settings, onOpenHome, onOpenCanvas, onOpenSettings }: SimpleGeneratePageProps) {
  const [step, setStep] = useState(1)
  const [ratio, setRatio] = useState<ImageRatio>('9:16')
  const [resolution, setResolution] = useState<ImageResolution>('2k')
  const [customWidth, setCustomWidth] = useState('1152')
  const [customHeight, setCustomHeight] = useState('2048')
  const [quality, setQuality] = useState('high')
  const [providerId, setProviderId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [draggingReferenceId, setDraggingReferenceId] = useState('')
  const [resultItem, setResultItem] = useState<ResultItem | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const imageProviders = useMemo(() => normalizeImageProviders(settings), [settings])
  const imageProvider = imageProviders.find((provider) => provider.id === providerId) || imageProviders[0]
  const model = selectedModel && imageProvider?.models.includes(selectedModel)
    ? selectedModel
    : imageProvider?.models[0] || settings.imageModel
  const outputSize = sizeForApi({
    size: '',
    ratio,
    resolution,
    customWidth,
    customHeight,
  })
  const providerReady = Boolean(imageProvider?.baseUrl && imageProvider?.apiKey)
  const progress = ((step - 1) / 3) * 100

  const updateSimpleSize = (nextRatio: ImageRatio, nextResolution: ImageResolution) => {
    const next = defaultCustomSize(nextRatio, nextResolution)
    if (next) {
      setCustomWidth(next.width)
      setCustomHeight(next.height)
    }
  }

  const changeRatio = (nextRatio: ImageRatio) => {
    setRatio(nextRatio)
    updateSimpleSize(nextRatio, resolution)
  }

  const changeResolution = (nextResolution: ImageResolution) => {
    setResolution(nextResolution)
    updateSimpleSize(ratio, nextResolution)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const images = await Promise.all(
      Array.from(files)
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, 10)
        .map(async (file) => ({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          dataUrl: await readFileAsDataUrl(file),
        })),
    )
    setReferenceImages((current) => [...current, ...images].slice(0, 10))
  }

  const moveReferenceImage = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return
    setReferenceImages((current) => {
      const fromIndex = current.findIndex((image) => image.id === fromId)
      const toIndex = current.findIndex((image) => image.id === toId)
      if (fromIndex === -1 || toIndex === -1) return current
      const nextImages = [...current]
      const [movedImage] = nextImages.splice(fromIndex, 1)
      nextImages.splice(toIndex, 0, movedImage)
      return nextImages
    })
  }

  const optimizeSimplePrompt = async () => {
    if (!prompt.trim()) return
    setIsOptimizing(true)
    setError('')
    setMessage('')
    try {
      const nextPrompt = await directOptimizePrompt(settings, prompt)
      setPrompt(nextPrompt.slice(0, 1000))
      setMessage('提示词已优化')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提示词优化失败')
    } finally {
      setIsOptimizing(false)
    }
  }

  const generateImage = async () => {
    const cleanPrompt = prompt.trim()
    setError('')
    setMessage('')

    if (!cleanPrompt) {
      setStep(3)
      setError('请先描述你想生成的图片。')
      return
    }
    if (!outputSize) {
      setStep(1)
      setError('请检查自定义分辨率，宽高需为 64-8192 且总像素不超过 829 万。')
      return
    }
    if (!imageProvider) {
      setError('请先在无限画布的设置里添加生图接口。')
      return
    }

    setStep(4)
    setIsGenerating(true)
    setResultItem(null)

    try {
      const job = await directGenerateImage({
        provider: imageProvider,
        model,
        prompt: cleanPrompt,
        size: outputSize,
        quality,
        referenceImages,
      })
      const url = job.resultUrls[0]
      const item: ResultItem = {
        id: `${job.jobId || 'simple'}-${Date.now()}`,
        url,
        status: 'done',
        sourceNodeId: 'simple-generate',
        sourceTitle: '海豹生图',
        prompt: cleanPrompt,
        model,
        size: outputSize,
        quality,
        jobId: job.jobId || `simple-${Date.now()}`,
        createdAt: new Date().toISOString(),
      }
      setResultItem(item)
      setMessage('图片生成成功')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成失败')
    } finally {
      setIsGenerating(false)
    }
  }

  const resetSimplePage = () => {
    setStep(1)
    setPrompt('')
    setReferenceImages([])
    setResultItem(null)
    setPreviewOpen(false)
    setMessage('')
    setError('')
  }

  return (
    <main className="simple-page">
      <header className="simple-topbar">
        <div className="simple-brand">
          <span className="brand-mark">海</span>
          <div>
            <h1>海豹生图</h1>
            <p>普通图片生成页面</p>
          </div>
        </div>
        <nav>
          <button type="button" className="toolbar-button" onClick={onOpenHome}>
            首页
          </button>
          <button type="button" className="toolbar-button" onClick={onOpenCanvas}>
            <Image size={17} />
            无限画布
          </button>
          <button type="button" className="toolbar-button" onClick={onOpenSettings}>
            <Settings size={17} />
            接口设置
          </button>
        </nav>
      </header>

      <section className="simple-main">
        <div className="simple-progress" aria-label="生成步骤">
          <div className="simple-progress-track" />
          <div className="simple-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
          {['规格', '参考图', '描述', '结果'].map((label, index) => {
            const value = index + 1
            return (
              <button
                type="button"
                className={`simple-step ${step === value ? 'active' : ''} ${step > value ? 'done' : ''}`}
                onClick={() => setStep(value)}
                disabled={isGenerating}
                key={label}
              >
                <span>{value}</span>
                {label}
              </button>
            )
          })}
        </div>

        {message || error ? (
          <div className={`simple-toast ${error ? 'failed' : ''}`} role="status">
            {error || message}
          </div>
        ) : null}

        <section className="simple-card">
          {step === 1 ? (
            <div className="simple-section">
              <div className="simple-section-head">
                <h2>选择生成规格</h2>
                <p>{imageProvider?.name || '未配置接口'} · {model || '未选择模型'} · {outputSize || '自定义尺寸无效'}</p>
              </div>
              {!providerReady ? (
                <button type="button" className="simple-warning" onClick={onOpenSettings}>
                  请先在无限画布设置里填写 API 地址和 Key
                </button>
              ) : null}
              <div className="simple-provider-grid">
                <label>
                  <span>接口</span>
                  <select
                    value={imageProvider?.id || ''}
                    onChange={(event) => {
                      const provider = imageProviders.find((item) => item.id === event.target.value)
                      setProviderId(event.target.value)
                      setSelectedModel(provider?.models[0] || settings.imageModel)
                    }}
                  >
                    {imageProviders.map((provider) => (
                      <option value={provider.id} key={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>模型</span>
                  <select value={model} onChange={(event) => setSelectedModel(event.target.value)}>
                    {(imageProvider?.models.length ? imageProvider.models : [settings.imageModel]).map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="simple-ratio-grid">
                {ratioOptions.map((option) => (
                  <button
                    type="button"
                    className={`simple-ratio ${ratio === option.value ? 'selected' : ''}`}
                    onClick={() => changeRatio(option.value)}
                    key={option.value}
                  >
                    <span className="ratio-frame-mini">
                      {option.box ? (
                        <span className="ratio-box-mini" style={{ width: option.box.width, height: option.box.height }} />
                      ) : (
                        <span className="auto-box-mini">AI</span>
                      )}
                    </span>
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="simple-segment">
                {(['1k', '2k', '4k', 'custom'] as ImageResolution[]).map((option) => (
                  <button
                    type="button"
                    className={resolution === option ? 'selected' : ''}
                    onClick={() => changeResolution(option)}
                    key={option}
                  >
                    {option === 'custom' ? '自定义' : option.toUpperCase()}
                  </button>
                ))}
              </div>
              {resolution === 'custom' ? (
                <div className="simple-custom-size">
                  <label>
                    宽
                    <input value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} inputMode="numeric" />
                  </label>
                  <label>
                    高
                    <input value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} inputMode="numeric" />
                  </label>
                </div>
              ) : null}
              <div className="simple-segment">
                {(['low', 'medium', 'high', 'auto'] as const).map((option) => (
                  <button
                    type="button"
                    className={quality === option ? 'selected' : ''}
                    onClick={() => setQuality(option)}
                    key={option}
                  >
                    {qualityLabels[option]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="simple-section">
              <div className="simple-section-head">
                <h2>参考图</h2>
                <p>不上传时默认走文生图接口；上传后走参考图编辑接口。</p>
              </div>
              <label
                className="simple-upload"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void handleFiles(event.dataTransfer.files)
                }}
              >
                <UploadCloud size={26} />
                <span>上传或拖入参考图片</span>
                <input type="file" accept="image/*" multiple onChange={(event) => void handleFiles(event.target.files)} />
              </label>
              {referenceImages.length > 0 ? (
                <div className="simple-reference-grid">
                  {referenceImages.map((image, index) => (
                    <figure
                      className={draggingReferenceId === image.id ? 'dragging' : ''}
                      draggable
                      onDragStart={(event) => {
                        setDraggingReferenceId(image.id)
                        event.dataTransfer.setData('text/plain', image.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        moveReferenceImage(draggingReferenceId || event.dataTransfer.getData('text/plain'), image.id)
                        setDraggingReferenceId('')
                      }}
                      onDragEnd={() => setDraggingReferenceId('')}
                      key={image.id}
                    >
                      <img src={image.dataUrl} alt={image.name} />
                      <span>{index + 1}</span>
                      <button
                        type="button"
                        onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== image.id))}
                        title="删除参考图"
                      >
                        <Trash2 size={14} />
                      </button>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="simple-empty">当前没有参考图，将使用文生图。</p>
              )}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="simple-section">
              <div className="simple-section-head">
                <h2>描述图片</h2>
                <p>写清主体、文字、构图、风格和用途。</p>
              </div>
              <div className="simple-prompt-wrap">
                <textarea
                  value={prompt}
                  maxLength={1000}
                  onChange={(event) => setPrompt(event.target.value.slice(0, 1000))}
                  placeholder="例如：生成一张 9:16 竖版新品图片，主体是一杯冰镇青梅茶，主标题“夏日青梅冷萃”，画面清爽高级，有自然光、水珠和冰块，背景干净，字体现代。"
                />
                <div>
                  <span>{prompt.length}/1000</span>
                  <button type="button" onClick={optimizeSimplePrompt} disabled={isOptimizing || !prompt.trim()}>
                    {isOptimizing ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
                    优化提示词
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="simple-section">
              <div className="simple-section-head">
                <h2>{isGenerating ? '正在生成图片' : resultItem ? '图片已生成' : '等待生成'}</h2>
                <p>{resultItem ? `${resultItem.model} · ${resultItem.size} · ${resultItem.quality}` : '生成较慢时请勿刷新页面。'}</p>
              </div>
              <div className={`simple-result ${resultItem ? 'has-image' : ''}`}>
                {isGenerating ? (
                  <div className="simple-loading">
                    <Loader2 className="spin" size={32} />
                    正在生成图片
                  </div>
                ) : resultItem ? (
                  <button type="button" onClick={() => setPreviewOpen(true)}>
                    <img src={resultItem.url} alt="生成结果" />
                  </button>
                ) : (
                  <div className="simple-loading">回到描述步骤开始生成</div>
                )}
              </div>
            </div>
          ) : null}

          <footer className="simple-actions">
            {step > 1 ? (
              <button
                type="button"
                className="mini-text-button simple-prev-button"
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                disabled={isGenerating}
              >
                上一步
              </button>
            ) : null}
            {step < 3 ? (
              <button type="button" className="primary-button" onClick={() => setStep((current) => Math.min(4, current + 1))}>
                下一步
              </button>
            ) : step === 4 && resultItem ? (
              <button type="button" className="primary-button" onClick={() => void downloadImage(resultItem.url, resultItem)} disabled={isGenerating}>
                <Download size={17} />
                下载图片
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={generateImage} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="spin" size={16} /> : <Sparkles size={17} />}
                {isGenerating ? '生成中' : '开始生成图片'}
              </button>
            )}
            {step === 4 && resultItem ? (
              <button type="button" className="mini-text-button" onClick={generateImage} disabled={isGenerating}>
                重新生成
              </button>
            ) : null}
            {step === 4 ? (
              <button type="button" className="mini-text-button simple-reset-button" onClick={resetSimplePage} disabled={isGenerating}>
                重新开始
              </button>
            ) : null}
          </footer>
        </section>
      </section>

      {previewOpen && resultItem ? (
        <div className="preview-modal" role="dialog" aria-modal="true" onClick={() => setPreviewOpen(false)}>
          <div className="preview-content" onClick={(event) => event.stopPropagation()}>
            <div className="preview-head">
              <div>
                <h2>海豹生图</h2>
                <p>{resultItem.model} · {resultItem.size} · {resultItem.quality}</p>
              </div>
              <div className="preview-actions">
                <a href={resultItem.url} target="_blank" rel="noreferrer" title="打开原图">
                  <ExternalLink size={17} />
                </a>
                <button type="button" onClick={() => void downloadImage(resultItem.url, resultItem)} title="下载图片">
                  <Download size={17} />
                </button>
                <button type="button" onClick={() => setPreviewOpen(false)} title="关闭预览">
                  <X size={18} />
                </button>
              </div>
            </div>
            <img src={resultItem.url} alt="生成结果大图" />
          </div>
        </div>
      ) : null}
    </main>
  )
}

function normalizeSettings(settings: Partial<ApiSettings>): ApiSettings {
  const merged = { ...defaultSettings, ...settings }
  const imageProviders = normalizeImageProviders(merged)
  return {
    ...merged,
    imageProviders,
    imageBaseUrl: imageProviders[0]?.baseUrl || merged.imageBaseUrl,
    imageApiKey: merged.imageApiKey || imageProviders[0]?.apiKey || '',
    imageModel: imageProviders[0]?.models?.[0] || merged.imageModel,
    llmApiKey: merged.llmApiKey || '',
  }
}

function normalizeImageProviders(settings: Partial<ApiSettings>): ImageProvider[] {
  const providers = Array.isArray(settings.imageProviders) ? settings.imageProviders : []
  const normalized = providers
    .map((provider, index) => ({
      id: provider.id || `image-provider-${index + 1}`,
      name: provider.name || `接口 ${index + 1}`,
      baseUrl: provider.baseUrl || settings.imageBaseUrl || defaultSettings.imageBaseUrl,
      apiKey: provider.apiKey?.trim() || '',
      models: provider.models?.map((model) => model.trim()).filter(Boolean).length
        ? provider.models.map((model) => model.trim()).filter(Boolean)
        : [settings.imageModel || defaultSettings.imageModel],
    }))
    .filter((provider) => provider.baseUrl)

  if (normalized.length > 0) return normalized

  return [
    {
      id: 'openai-compatible',
      name: 'OpenAI 兼容',
      baseUrl: settings.imageBaseUrl || defaultSettings.imageBaseUrl,
      apiKey: settings.imageApiKey?.trim() || '',
      models: [settings.imageModel || defaultSettings.imageModel],
    },
  ]
}

function editableProviders(settings: Partial<ApiSettings>): ImageProvider[] {
  const providers = Array.isArray(settings.imageProviders) ? settings.imageProviders : []
  if (providers.length > 0) {
    return providers.map((provider, index) => ({
      id: provider.id || `image-provider-${index + 1}`,
      name: provider.name || `接口 ${index + 1}`,
      baseUrl: provider.baseUrl || settings.imageBaseUrl || defaultSettings.imageBaseUrl,
      apiKey: provider.apiKey || '',
      models: provider.models?.length ? provider.models : [defaultSettings.imageModel],
    }))
  }

  return [
    {
      id: 'openai-compatible',
      name: 'OpenAI 兼容',
      baseUrl: settings.imageBaseUrl || defaultSettings.imageBaseUrl,
      apiKey: settings.imageApiKey || '',
      models: [settings.imageModel || defaultSettings.imageModel],
    },
  ]
}

function providerForGenerate(data: GenerateNodeData, providers: ImageProvider[]) {
  return providers.find((provider) => provider.id === data.providerId) || providers[0] || normalizeImageProviders(defaultSettings)[0]
}

function privateSettings(settings: ApiSettings): ApiSettings {
  const imageProviders = normalizeImageProviders(settings)
  return {
    ...settings,
    imageProviders,
    imageBaseUrl: imageProviders[0]?.baseUrl || settings.imageBaseUrl,
    imageApiKey: imageProviders[0]?.apiKey?.trim() || settings.imageApiKey?.trim(),
    imageModel: imageProviders[0]?.models?.[0] || settings.imageModel,
  }
}

function loadStandaloneSettings(): ApiSettings {
  try {
    const saved = window.localStorage.getItem(settingsStorageKey) || window.localStorage.getItem(legacySettingsStorageKey)
    if (!saved) return defaultSettings
    return normalizeSettings(JSON.parse(saved) as Partial<ApiSettings>)
  } catch {
    return defaultSettings
  }
}

function saveStandaloneSettings(settings: ApiSettings) {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
}

async function directGenerateImage(input: DirectGenerateInput): Promise<JobResponse> {
  const baseUrl = normalizeBaseUrl(input.provider.baseUrl)
  const apiKey = input.provider.apiKey.trim()
  if (!baseUrl) throw new Error('缺少生图 API 地址。')
  if (!apiKey) throw new Error('缺少生图 API Key。')

  const hasReferences = input.referenceImages.length > 0
  const endpoint = hasReferences ? `${baseUrl}/v1/images/edits` : `${baseUrl}/v1/images/generations`
  const response = hasReferences
    ? await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: imageEditFormData(input),
      })
    : await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          n: 1,
          response_format: 'url',
        }),
      })

  const body = await responseJson(response)
  if (!response.ok) throw new Error(extractApiError(body, '生图失败。'))

  const resultUrls = extractImageUrls(body)
  if (resultUrls.length === 0) throw new Error('生图接口没有返回图片。')

  return {
    jobId: body?.id || `direct-${Date.now()}`,
    status: 'done',
    resultUrls,
  }
}

function imageEditFormData(input: DirectGenerateInput) {
  const form = new FormData()
  form.set('model', input.model)
  form.set('prompt', input.prompt)
  form.set('size', input.size)
  form.set('quality', input.quality)
  form.set('n', '1')
  form.set('response_format', 'url')
  for (const image of input.referenceImages.slice(0, 10)) {
    form.append('image', dataUrlToFile(image.dataUrl, image.name || 'reference.png'))
  }
  return form
}

async function directOptimizePrompt(settings: ApiSettings, prompt: string) {
  const baseUrl = normalizeBaseUrl(settings.llmBaseUrl)
  const apiKey = settings.llmApiKey.trim()
  if (!baseUrl || !apiKey || !settings.llmModel.trim()) {
    throw new Error('请先填写 LLM API 地址、Key 和模型。')
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.llmModel,
      temperature: 0.35,
      messages: [
        {
          role: 'system',
          content:
            '你是 AI 图片生成提示词优化器。请只返回优化后的提示词，不要解释。优先使用中文输出；如果用户原文是中文或包含需要出现在图片里的中文文字，必须保留中文，不要翻译成英文。把需要模型准确生成的画面文字用中文引号标出。',
        },
        {
          role: 'user',
          content: `请优化这个图片生成提示词，返回适合直接用于生图的中文提示词：\n\n${prompt}`,
        },
      ],
    }),
  })
  const body = await responseJson(response)
  if (!response.ok) throw new Error(extractApiError(body, '提示词优化失败。'))
  const optimized = body?.choices?.[0]?.message?.content?.trim()
  if (!optimized) throw new Error('LLM 没有返回可用提示词。')
  return optimized
}

function normalizeBaseUrl(value: string) {
  return String(value || '').replace(/\/+$/, '')
}

async function responseJson(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

function extractApiError(body: unknown, fallback: string) {
  const data = body as {
    error?: string | { message?: string }
    message?: string
    data?: { error_message?: string }
  } | null
  if (typeof data?.error === 'string') return data.error
  return data?.error?.message || data?.message || data?.data?.error_message || fallback
}

function extractImageUrls(body: unknown) {
  const output: string[] = []
  const seen = new Set<string>()

  const addImage = (value: unknown) => {
    const normalized = normalizeImageSource(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    output.push(normalized)
  }

  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return
    if (typeof value === 'string') {
      addImage(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1))
      return
    }
    if (!isRecord(value)) return

    addImage(value.url)
    addImage(value.image_url)
    addImage(value.imageUrl)
    addImage(value.b64_json)
    addImage(value.base64)
    addImage(value.image_base64)
    addImage(value.imageBase64)
    addImage(value.image)

    visit(value.image_url, depth + 1)
    visit(value.imageUrl, depth + 1)
    visit(value.image, depth + 1)
    visit(value.data, depth + 1)
    visit(value.images, depth + 1)
    visit(value.result_urls, depth + 1)
    visit(value.resultUrls, depth + 1)
    visit(value.output, depth + 1)
    visit(value.result, depth + 1)
  }

  visit(body)
  return output
}

function normalizeImageSource(value: unknown) {
  if (typeof value !== 'string') return ''
  const source = value.trim()
  if (!source) return ''
  if (/^(https?:|data:image\/|blob:)/i.test(source)) return source
  const base64Payload = source.replace(/^data:[^,]+,/, '').replace(/\s/g, '')
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(base64Payload) && base64Payload.length > 80) {
    return `data:image/png;base64,${base64Payload}`
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const blob = dataUrlToBlob(dataUrl)
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}

function normalizeResultData(data: ResultNodeData): ResultNodeData {
  const items = resultItemsFromData(data)
  return {
    ...data,
    mode: data.mode || 'append',
    urls: items.map((item) => item.url),
    items,
  }
}

function resultItemsFromData(data: ResultNodeData): ResultItem[] {
  if (Array.isArray(data.items) && data.items.length > 0) {
    return data.items.map((item) => ({ ...item, status: item.status || 'done' }))
  }
  return (data.urls || []).map((url, index) => ({
    id: `${url}-${index}`,
    url,
    status: 'done',
    sourceNodeId: '',
    sourceTitle: data.title || '结果',
    prompt: '',
    model: '',
    size: '',
    quality: '',
    jobId: '',
    createdAt: '',
  }))
}

async function downloadImage(url: string, item?: Partial<ResultItem>) {
  try {
    const blob = url.startsWith('data:') ? dataUrlToBlob(url) : await fetch(url).then((response) => {
      if (!response.ok) throw new Error('下载图片失败')
      return response.blob()
    })
    const link = document.createElement('a')
    const objectUrl = URL.createObjectURL(blob)
    link.href = objectUrl
    link.download = fileNameForResult(item, extensionFromBlob(blob, url))
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

function dataUrlToBlob(dataUrl: string) {
  const [header, payload = ''] = dataUrl.split(',')
  const mimeType = header.match(/^data:([^;]+)/)?.[1] || 'image/png'
  const binary = window.atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

function extensionFromDataUrl(dataUrl: string) {
  const mimeType = dataUrl.match(/^data:([^;]+)/)?.[1] || 'image/png'
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

function extensionFromUrl(url: string) {
  return url.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/)?.[1]?.toLowerCase() || 'png'
}

function extensionFromBlob(blob: Blob, fallbackUrl = '') {
  if (blob.type.includes('jpeg')) return 'jpg'
  if (blob.type.includes('webp')) return 'webp'
  if (blob.type.includes('gif')) return 'gif'
  if (blob.type.includes('png')) return 'png'
  return fallbackUrl.startsWith('data:') ? extensionFromDataUrl(fallbackUrl) : extensionFromUrl(fallbackUrl)
}

function fileNameForResult(item?: Partial<ResultItem>, extension = 'png') {
  const job = item?.jobId ? item.jobId.replace(/[^a-zA-Z0-9_-]/g, '') : `image-${Date.now()}`
  return `seal-canvas-${job}.${extension}`
}

function sizeForApi(data: Pick<GenerateNodeData, 'size'> & Partial<GenerateNodeData>) {
  const ratio = data.ratio || ratioFromSize(data.size)
  const resolution = data.resolution || resolutionFromSize(data.size)
  if (resolution === 'custom') return getCustomSizeValue(data.customWidth, data.customHeight)
  if (ratio === 'Auto') return 'auto'
  return sizePresets[ratio]?.[resolution] || data.size || '1152x2048'
}

function defaultCustomSize(ratio: ImageRatio, resolution: ImageResolution) {
  const fallback = sizePresets['9:16']['2k']
  if (resolution === 'custom') return splitSizeValue(sizePresets[ratio === 'Auto' ? '9:16' : ratio]?.['2k'] || fallback)!
  if (ratio === 'Auto') return splitSizeValue(sizePresets['9:16'][resolution] || fallback)!
  return splitSizeValue(sizePresets[ratio][resolution] || fallback)!
}

function getCustomSizeValue(widthValue?: string, heightValue?: string) {
  const width = Math.round(Number(widthValue))
  const height = Math.round(Number(heightValue))
  if (!width && !height) return ''
  if (width < 64 || height < 64 || width > 8192 || height > 8192) return ''
  if (width * height > maxTotalPixels) return ''
  return `${width}x${height}`
}

function splitSizeValue(size?: string) {
  const match = String(size || '').match(/^(\d+)x(\d+)$/)
  return match ? { width: match[1], height: match[2] } : null
}

function ratioFromSize(size?: string): ImageRatio {
  const parts = splitSizeValue(size)
  if (!parts) return '9:16'
  const width = Number(parts.width)
  const height = Number(parts.height)
  const ratio = width / height
  const candidates: Array<[ImageRatio, number]> = [
    ['1:1', 1],
    ['9:16', 9 / 16],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
  ]
  return candidates.reduce((best, current) =>
    Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best,
  )[0]
}

function resolutionFromSize(size?: string): ImageResolution {
  const parts = splitSizeValue(size)
  if (!parts) return '2k'
  const longest = Math.max(Number(parts.width), Number(parts.height))
  if (longest <= 1024) return '1k'
  if (longest <= 2048) return '2k'
  return '4k'
}

function collectGenerateInput(generateId: string, nodes: AppNode[], edges: Edge[]) {
  const sourceIds = edges.filter((edge) => edge.target === generateId).map((edge) => edge.source)
  const upstreamNodes = sourceIds
    .map((sourceId) => nodes.find((node) => node.id === sourceId))
    .filter((node): node is AppNode => Boolean(node))

  const promptNodes = upstreamNodes.filter((node) => node.type === 'prompt') as Node<PromptNodeData>[]
  const referenceNodes = upstreamNodes.filter((node) => node.type === 'reference') as Node<ReferenceNodeData>[]

  const prompt = promptNodes.map((node) => node.data.prompt.trim()).filter(Boolean).join('\n\n')
  const referenceImages = referenceNodes.flatMap((node) => node.data.images || [])

  return { prompt, referenceImages }
}

function createEdge(source?: string | null, target?: string | null): Edge {
  return {
    id: `${source}-${target}-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    source: source || '',
    target: target || '',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function statusText(status: GenerateStatus) {
  const map: Record<GenerateStatus, string> = {
    idle: '待生成',
    pending: '排队中',
    running: '生成中',
    done: '完成',
    failed: '失败',
  }
  return map[status]
}

export default App
