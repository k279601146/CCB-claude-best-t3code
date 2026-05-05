import { describe, expect, test } from 'bun:test'
import type { Command } from '../../commands'
import { getEmptyToolPermissionContext } from '../../Tool'
import {
  processDpcodeSelectedSkill,
  resolveDpcodeSelectedSkillCommand,
} from '../selectedSkills'

function createToolUseContext(): any {
  let appState = {
    toolPermissionContext: getEmptyToolPermissionContext(),
    fastMode: false,
    mcp: {
      tools: [],
      clients: [],
      commands: [],
      resources: {},
    },
    effortValue: undefined,
    advisorModel: undefined,
    sessionHooks: new Map(),
  }

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5-20250929',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: [],
        allowedAgentTypes: [],
      },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => appState,
    setAppState: (updater: (state: any) => any) => {
      appState = updater(appState)
    },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  }
}

function makeSkillCommand(overrides: Partial<Command> = {}): Command {
  return {
    type: 'prompt',
    name: 'verify',
    description: 'Verify changes',
    progressMessage: 'Loading verify',
    contentLength: 13,
    source: 'bundled',
    loadedFrom: 'bundled',
    allowedTools: ['Read', 'Grep'],
    skillRoot: 'ccb://bundled/verify',
    getPromptForCommand: async () => [
      { type: 'text', text: 'Use this native skill content.' },
    ],
    ...overrides,
  } as Command
}

describe('DP Code selected skills bridge', () => {
  test('resolves selected skills by native name, display name, and path', () => {
    const command = makeSkillCommand({
      userFacingName: () => 'Verify',
    })

    expect(
      resolveDpcodeSelectedSkillCommand([command], { name: 'verify' }),
    ).toBe(command)
    expect(
      resolveDpcodeSelectedSkillCommand([command], { name: 'Verify' }),
    ).toBe(command)
    expect(
      resolveDpcodeSelectedSkillCommand([command], {
        name: 'stale-ui-name',
        path: 'ccb://bundled/verify',
      }),
    ).toBe(command)
  })

  test('loads selected skill content through CCB prompt slash-command semantics', async () => {
    const command = makeSkillCommand()
    const result = await processDpcodeSelectedSkill({
      selectedSkill: { name: 'verify', path: 'ccb://bundled/verify' },
      commands: [command],
      context: createToolUseContext(),
    })

    expect(result.shouldQuery).toBe(true)
    expect(result.allowedTools).toEqual(['Read', 'Grep'])
    expect(JSON.stringify(result.messages)).toContain(
      'Use this native skill content.',
    )
    expect(JSON.stringify(result.messages)).toContain('command_permissions')
  })

  test('rejects disabled or hidden selected skills at invocation time', async () => {
    await expect(
      processDpcodeSelectedSkill({
        selectedSkill: { name: 'verify', path: 'ccb://bundled/verify' },
        commands: [makeSkillCommand({ isEnabled: () => false })],
        context: createToolUseContext(),
      }),
    ).rejects.toThrow('disabled or hidden')

    await expect(
      processDpcodeSelectedSkill({
        selectedSkill: { name: 'verify', path: 'ccb://bundled/verify' },
        commands: [makeSkillCommand({ isHidden: true })],
        context: createToolUseContext(),
      }),
    ).rejects.toThrow('disabled or hidden')
  })
})
