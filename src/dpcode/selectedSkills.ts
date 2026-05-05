import type { Command } from '../commands.js'
import { getCommandName, isCommandEnabled } from '../commands.js'
import type {
  ProcessUserInputBaseResult,
  ProcessUserInputContext,
} from '../utils/processUserInput/processUserInput.js'

const SKILL_LOADED_FROM = new Set([
  'commands_DEPRECATED',
  'skills',
  'plugin',
  'managed',
  'bundled',
  'mcp',
])

export type DpcodeSelectedSkillReference = {
  name: string
  path?: string
}

export function isDpcodeSelectedSkillCommand(command: Command): boolean {
  return (
    command.type === 'prompt' &&
    (SKILL_LOADED_FROM.has(command.loadedFrom ?? '') ||
      command.skillRoot !== undefined ||
      command.whenToUse !== undefined)
  )
}

export function dpcodeSelectedSkillPath(command: Command): string {
  return (
    command.skillRoot ??
    `ccb://${command.loadedFrom ?? 'skill'}/${command.name}`
  )
}

export function resolveDpcodeSelectedSkillCommand(
  commands: Command[],
  selectedSkill: DpcodeSelectedSkillReference,
): Command | undefined {
  return commands.find(command => {
    if (!isDpcodeSelectedSkillCommand(command)) return false
    if (
      command.name === selectedSkill.name ||
      getCommandName(command) === selectedSkill.name
    ) {
      return true
    }
    return (
      selectedSkill.path !== undefined &&
      dpcodeSelectedSkillPath(command) === selectedSkill.path
    )
  })
}

export function mergeDpcodeSelectedSkillAllowedTools(
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string> | undefined,
): string[] | undefined {
  const merged = [...first, ...(second ?? [])].filter(Boolean)
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined
}

export async function processDpcodeSelectedSkill(input: {
  selectedSkill: DpcodeSelectedSkillReference
  commands: Command[]
  context: ProcessUserInputContext
}): Promise<ProcessUserInputBaseResult> {
  const command = resolveDpcodeSelectedSkillCommand(
    input.commands,
    input.selectedSkill,
  )
  const displayName = input.selectedSkill.path
    ? `${input.selectedSkill.name} (${input.selectedSkill.path})`
    : input.selectedSkill.name
  if (!command) {
    throw new Error(`Selected CCB skill is not available: ${displayName}`)
  }
  if (!isCommandEnabled(command) || command.isHidden) {
    throw new Error(`Selected CCB skill is disabled or hidden: ${displayName}`)
  }

  const { processPromptSlashCommand } = await import(
    '../utils/processUserInput/processSlashCommand.js'
  )
  return await processPromptSlashCommand(
    command.name,
    '',
    input.commands,
    input.context,
  )
}
