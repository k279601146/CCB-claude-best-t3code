import { randomUUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { QueryEngineConfig } from '../QueryEngine.js'
import type { SDKMessage } from '../entrypoints/sdk/coreTypes.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { PermissionMode } from '../types/permissions.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Tool, ToolPermissionContext } from '../Tool.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../services/mcp/types.js'
import {
  getCommandName,
  isCommandEnabled,
  type Command,
} from '../types/command.js'

export type DpcodeCcbPermissionMode = PermissionMode
export type DpcodeCcbSdkMessage = SDKMessage
export type DpcodeCcbQueryInput = string | ContentBlockParam[]
export type DpcodeCcbSelectedSkill = {
  name: string
  path?: string
}

export type DpcodeCcbSessionOptions = {
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  canUseTool: CanUseToolFn
  initialMessages?: QueryEngineConfig['initialMessages']
  customSystemPrompt?: string
  appendSystemPrompt?: string
  languagePreference?: string
  fastModel?: string
  settingsJson?: string
  featureOptions?: {
    enableSkillSearch?: boolean
    enableForkSubagents?: boolean
    enableAgentSwarms?: boolean
    enableWorktreeTools?: boolean
  }
  fallbackModel?: string
  openAiBaseUrl?: string
  openAiApiKey?: string
}

export type DpcodeCcbSession = {
  sessionId: string
  submitMessage(
    prompt: DpcodeCcbQueryInput,
    options?: {
      uuid?: string
      isMeta?: boolean
      selectedSkills?: ReadonlyArray<DpcodeCcbSelectedSkill>
    },
  ): AsyncGenerator<SDKMessage, void, unknown>
  interrupt(): void
  resetAbortController(): void
  getAbortSignal(): AbortSignal
  getMessages(): readonly unknown[]
  setModel(model: string): void
  stopBackgroundTask(taskId: string): Promise<{
    taskId: string
    taskType: string
    command: string | undefined
  }>
  setPermissionMode(mode: DpcodeCcbPermissionMode): void
  getMcpStatus(): DpcodeCcbLiveMcpStatus
}

export type DpcodeCcbCommand = {
  name: string
  description?: string
}

export type DpcodeCcbSkill = {
  name: string
  description?: string
  path: string
  enabled: boolean
  scope?: string
  displayName?: string
  shortDescription?: string
}

export type DpcodeCcbAgent = {
  name: string
  displayName?: string
  description?: string
  model?: string
}

export type DpcodeCcbMcpStatus = {
  servers: Array<{
    name: string
    transport: string
    scope?: string
    enabled: boolean
  }>
  errors: string[]
}

export type DpcodeCcbLiveMcpStatus = DpcodeCcbMcpStatus & {
  tools: Array<{ name: string }>
  commands: Array<{ name: string }>
  resources: Array<{ server: string; count: number }>
}

const SKILL_LOADED_FROM = new Set([
  'commands_DEPRECATED',
  'skills',
  'plugin',
  'managed',
  'bundled',
  'mcp',
])

function isSkillCommand(command: Command): boolean {
  return (
    command.type === 'prompt' &&
    (SKILL_LOADED_FROM.has(command.loadedFrom ?? '') ||
      command.skillRoot !== undefined ||
      command.whenToUse !== undefined)
  )
}

function skillPath(command: Command): string {
  return (
    command.skillRoot ??
    `ccb://${command.loadedFrom ?? 'skill'}/${command.name}`
  )
}

function skillScope(command: Command): string | undefined {
  return command.loadedFrom ?? command.source
}

function applyOpenAiCompatibleEnv(
  options: Pick<
    DpcodeCcbSessionOptions,
    'openAiApiKey' | 'openAiBaseUrl' | 'model' | 'fastModel'
  >,
): void {
  if (!options.openAiBaseUrl && !options.openAiApiKey) return

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  if (options.openAiBaseUrl) {
    process.env.OPENAI_BASE_URL = options.openAiBaseUrl
  }
  if (options.openAiApiKey) {
    process.env.OPENAI_API_KEY = options.openAiApiKey
  }
  if (options.model) {
    process.env.OPENAI_MODEL = options.model
    process.env.OPENAI_DEFAULT_SONNET_MODEL = options.model
    process.env.OPENAI_DEFAULT_OPUS_MODEL = options.model
  }
  const fastModel = options.fastModel?.trim() || 'gemini-2.5-flash'
  process.env.OPENAI_DEFAULT_HAIKU_MODEL = fastModel
}

function applyDpcodeShellEnv(): void {
  if (process.platform !== 'win32') return

  process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL ??= '1'
}

export function shouldDenyBashForDpcodeWindows(
  env: Pick<NodeJS.ProcessEnv, 'DPCODE_CCB_KEEP_BASH_ON_WINDOWS'> = process.env,
  platform = process.platform,
): boolean {
  return platform === 'win32' && env.DPCODE_CCB_KEEP_BASH_ON_WINDOWS !== '1'
}

export function applyDpcodeToolPermissionPolicy(
  context: ToolPermissionContext,
  env: Pick<NodeJS.ProcessEnv, 'DPCODE_CCB_KEEP_BASH_ON_WINDOWS'> = process.env,
  platform = process.platform,
): ToolPermissionContext {
  if (!shouldDenyBashForDpcodeWindows(env, platform)) {
    return context
  }

  const sessionDenyRules = context.alwaysDenyRules.session ?? []
  if (sessionDenyRules.includes('Bash')) {
    return context
  }

  return {
    ...context,
    alwaysDenyRules: {
      ...context.alwaysDenyRules,
      session: [...sessionDenyRules, 'Bash'],
    },
  }
}

function applyDpcodeFeatureEnv(
  options: Pick<DpcodeCcbSessionOptions, 'featureOptions'>,
): void {
  const featureOptions = options.featureOptions
  if (!featureOptions) return

  if (featureOptions.enableSkillSearch !== undefined) {
    process.env.SKILL_SEARCH_ENABLED = featureOptions.enableSkillSearch
      ? '1'
      : '0'
  }
  if (featureOptions.enableAgentSwarms !== undefined) {
    if (featureOptions.enableAgentSwarms) {
      delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_DISABLED
    } else {
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_DISABLED = '1'
    }
  }
  if (featureOptions.enableForkSubagents !== undefined) {
    process.env.CLAUDE_CODE_EXPERIMENTAL_FORK_SUBAGENT =
      featureOptions.enableForkSubagents ? '1' : '0'
  }
  if (featureOptions.enableWorktreeTools !== undefined) {
    process.env.CLAUDE_CODE_EXPERIMENTAL_WORKTREE =
      featureOptions.enableWorktreeTools ? '1' : '0'
  }
}

function applyDpcodeSettingsJson(
  options: Pick<DpcodeCcbSessionOptions, 'settingsJson'>,
): void {
  if (!options.settingsJson) return

  try {
    const parsed = JSON.parse(options.settingsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const env = (parsed as { env?: unknown }).env
    if (!env || typeof env !== 'object' || Array.isArray(env)) return

    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Z0-9_]+$/.test(key)) continue
      if (typeof value === 'string') {
        process.env[key] = value
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        process.env[key] = String(value)
      }
    }
  } catch {
    // Invalid user JSON should not prevent session startup. DP Code still
    // passes explicit typed options such as language and feature toggles.
  }
}

function normalizeDpcodeTools(tools: Tool[]): Tool[] {
  if (
    process.platform !== 'win32' ||
    process.env.DPCODE_CCB_KEEP_BASH_ON_WINDOWS === '1'
  ) {
    return tools
  }

  return tools.filter(tool => tool.name !== 'Bash')
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback
}

type DpcodeCcbMcpSetup = {
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
  resources: Record<string, ServerResource[]>
  errors: string[]
}

async function setupDpcodeCcbMcp(
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<DpcodeCcbMcpSetup> {
  const { getMcpToolsCommandsAndResources } = await import(
    '../services/mcp/client.js'
  )
  const clients: MCPServerConnection[] = []
  const tools: Tool[] = []
  const commands: Command[] = []
  const resources: Record<string, ServerResource[]> = {}
  const errors: string[] = []

  try {
    await getMcpToolsCommandsAndResources(result => {
      const existingIndex = clients.findIndex(
        client => client.name === result.client.name,
      )
      if (existingIndex >= 0) {
        clients[existingIndex] = result.client
      } else {
        clients.push(result.client)
      }

      if (result.client.type === 'failed') {
        errors.push(
          `${result.client.name}: ${result.client.error ?? 'Connection failed'}`,
        )
      }

      tools.push(...result.tools)
      commands.push(...result.commands)
      if (result.resources) {
        resources[result.client.name] = result.resources
      }

      setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: [...clients],
          tools: [...tools],
          commands: [...commands],
          resources: { ...resources },
        },
      }))
    })
  } catch (error) {
    errors.push(errorText(error, 'Failed to initialize MCP'))
  }

  return { clients, tools, commands, resources, errors }
}

export async function listDpcodeCcbCommands(
  cwd: string,
): Promise<DpcodeCcbCommand[]> {
  const { setCwdState, setOriginalCwd, setProjectRoot } = await import(
    '../bootstrap/state.js'
  )
  const { getCommands } = await import('../commands.js')
  setOriginalCwd(cwd)
  setCwdState(cwd)
  setProjectRoot(cwd)
  const commands = await getCommands(cwd)
  return commands
    .filter(command => !isSkillCommand(command) && !command.isHidden)
    .map(command => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
    }))
}

export async function listDpcodeCcbSkills(
  cwd: string,
): Promise<DpcodeCcbSkill[]> {
  const { setCwdState, setOriginalCwd, setProjectRoot } = await import(
    '../bootstrap/state.js'
  )
  const { getCommands } = await import('../commands.js')
  setOriginalCwd(cwd)
  setCwdState(cwd)
  setProjectRoot(cwd)
  const commands = await getCommands(cwd)
  return commands
    .filter(command => isSkillCommand(command))
    .map(command => {
      const displayName = getCommandName(command)
      return {
        name: command.name,
        ...(command.description ? { description: command.description } : {}),
        path: skillPath(command),
        enabled: isCommandEnabled(command) && !command.isHidden,
        ...(skillScope(command) ? { scope: skillScope(command) } : {}),
        ...(displayName && displayName !== command.name ? { displayName } : {}),
        ...(command.description
          ? { shortDescription: command.description }
          : {}),
      }
    })
}

export async function listDpcodeCcbMcpStatus(
  cwd: string,
): Promise<DpcodeCcbMcpStatus> {
  const [
    { setCwdState, setOriginalCwd, setProjectRoot },
    { getAllMcpConfigs, isMcpServerDisabled },
    { getPluginErrorMessage },
  ] = await Promise.all([
    import('../bootstrap/state.js'),
    import('../services/mcp/config.js'),
    import('../types/plugin.js'),
  ])

  setOriginalCwd(cwd)
  setCwdState(cwd)
  setProjectRoot(cwd)
  try {
    process.chdir(cwd)
  } catch {
    // Keep status discovery best-effort; CCB will surface cwd failures through
    // normal session startup/turn errors.
  }

  const { servers, errors } = await getAllMcpConfigs()
  return {
    servers: Object.entries(servers).map(([name, config]) => ({
      name,
      transport: config.type ?? 'stdio',
      ...(config.scope ? { scope: config.scope } : {}),
      enabled: !isMcpServerDisabled(name),
    })),
    errors: errors.map(error => getPluginErrorMessage(error)),
  }
}

export async function listDpcodeCcbAgents(
  cwd: string,
): Promise<DpcodeCcbAgent[]> {
  const [
    { setCwdState, setOriginalCwd, setProjectRoot },
    { getAgentDefinitionsWithOverrides, getActiveAgentsFromList },
  ] = await Promise.all([
    import('../bootstrap/state.js'),
    import('@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'),
  ])

  setOriginalCwd(cwd)
  setCwdState(cwd)
  setProjectRoot(cwd)
  try {
    process.chdir(cwd)
  } catch {
    // Agent discovery stays best-effort; session startup will surface cwd
    // failures through the normal runtime error path.
  }

  const definitions = await getAgentDefinitionsWithOverrides(cwd)
  const activeAgents = getActiveAgentsFromList(definitions.allAgents)
  return activeAgents.map(agent => ({
    name: agent.agentType,
    displayName: agent.agentType,
    description: agent.whenToUse,
    ...(agent.model ? { model: agent.model } : {}),
  }))
}

export async function createDpcodeCcbSession(
  options: DpcodeCcbSessionOptions,
): Promise<DpcodeCcbSession> {
  applyOpenAiCompatibleEnv(options)
  applyDpcodeShellEnv()
  applyDpcodeFeatureEnv(options)
  applyDpcodeSettingsJson(options)

  const [
    { QueryEngine },
    { assembleToolPool },
    { getEmptyToolPermissionContext },
    { getCommands },
    { enableConfigs },
    { FileStateCache },
    { getDefaultAppState },
    { setCwdState, setOriginalCwd, setProjectRoot },
    { stopTask },
    { clearOpenAIClientCache },
    { getAgentDefinitionsWithOverrides, getActiveAgentsFromList },
  ] = await Promise.all([
    import('../QueryEngine.js'),
    import('../tools.js'),
    import('../Tool.js'),
    import('../commands.js'),
    import('../utils/config.js'),
    import('../utils/fileStateCache.js'),
    import('../state/AppStateStore.js'),
    import('../bootstrap/state.js'),
    import('../tasks/stopTask.js'),
    import('../services/api/openai/client.js'),
    import('@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'),
  ])

  clearOpenAIClientCache()
  enableConfigs()
  bindDpcodeCcbSessionCwdSync({
    cwd: options.cwd,
    setOriginalCwd,
    setCwdState,
    setProjectRoot,
  })

  const permissionContext = applyDpcodeToolPermissionPolicy(
    getEmptyToolPermissionContext(),
  )
  const appState: AppState = {
    ...getDefaultAppState(),
    toolPermissionContext: {
      ...permissionContext,
      mode: options.permissionMode ?? 'default',
    },
  }
  const setAppState = (updater: (prev: AppState) => AppState) => {
    Object.assign(appState, updater(appState))
  }
  const [commands, mcpSetup, agentDefinitions] = await Promise.all([
    getCommands(options.cwd),
    setupDpcodeCcbMcp(setAppState),
    getAgentDefinitionsWithOverrides(options.cwd),
  ])
  const agents = getActiveAgentsFromList(agentDefinitions.allAgents)
  setAppState(prev => ({
    ...prev,
    agentDefinitions: {
      ...agentDefinitions,
      activeAgents: agents,
    },
  }))

  const engine = new QueryEngine({
    cwd: options.cwd,
    tools: normalizeDpcodeTools(
      assembleToolPool(appState.toolPermissionContext, mcpSetup.tools),
    ),
    refreshTools: () =>
      normalizeDpcodeTools(
        assembleToolPool(appState.toolPermissionContext, mcpSetup.tools),
      ),
    commands: [...commands, ...mcpSetup.commands],
    mcpClients: mcpSetup.clients,
    mcpResources: mcpSetup.resources,
    agents,
    canUseTool: options.canUseTool,
    getAppState: () => appState,
    setAppState,
    readFileCache: new FileStateCache(500, 50 * 1024 * 1024),
    includePartialMessages: true,
    replayUserMessages: true,
    ...(options.initialMessages
      ? { initialMessages: options.initialMessages }
      : {}),
    ...(options.customSystemPrompt
      ? { customSystemPrompt: options.customSystemPrompt }
      : {}),
    ...(options.appendSystemPrompt
      ? { appendSystemPrompt: options.appendSystemPrompt }
      : {}),
    ...(options.model ? { userSpecifiedModel: options.model } : {}),
    ...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
  })

  return {
    sessionId: randomUUID(),
    submitMessage: (prompt, submitOptions) =>
      engine.submitMessage(prompt, submitOptions),
    interrupt: () => engine.interrupt(),
    resetAbortController: () => engine.resetAbortController(),
    getAbortSignal: () => engine.getAbortSignal(),
    getMessages: () => engine.getMessages() as readonly unknown[],
    setModel: model => engine.setModel(model),
    stopBackgroundTask: taskId =>
      stopTask(taskId, { getAppState: () => appState, setAppState }),
    setPermissionMode: mode =>
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: {
          ...prev.toolPermissionContext,
          mode,
        },
      })),
    getMcpStatus: () => ({
      servers: mcpSetup.clients.map(client => ({
        name: client.name,
        transport: client.config.type ?? 'stdio',
        ...(client.config.scope ? { scope: client.config.scope } : {}),
        enabled: client.type !== 'failed',
      })),
      errors: [...mcpSetup.errors],
      tools: mcpSetup.tools.map(tool => ({ name: tool.name })),
      commands: mcpSetup.commands.map(command => ({ name: command.name })),
      resources: Object.entries(mcpSetup.resources).map(
        ([server, resources]) => ({
          server,
          count: resources.length,
        }),
      ),
    }),
  }
}

function bindDpcodeCcbSessionCwdSync(input: {
  cwd: string
  setOriginalCwd: (cwd: string) => void
  setCwdState: (cwd: string) => void
  setProjectRoot: (cwd: string) => void
}): void {
  input.setOriginalCwd(input.cwd)
  input.setCwdState(input.cwd)
  input.setProjectRoot(input.cwd)

  try {
    process.chdir(input.cwd)
  } catch {
    // CCB can still initialize enough state for DPcode to surface the cwd error
    // through its normal runtime error path.
  }
}

export async function runDpcodeCcbWithCwd<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  const [
    { setCwdState, setOriginalCwd, setProjectRoot },
    { runWithCwdOverride },
  ] = await Promise.all([
    import('../bootstrap/state.js'),
    import('../utils/cwd.js'),
  ])

  bindDpcodeCcbSessionCwdSync({
    cwd,
    setOriginalCwd,
    setCwdState,
    setProjectRoot,
  })

  return await runWithCwdOverride(cwd, operation)
}
