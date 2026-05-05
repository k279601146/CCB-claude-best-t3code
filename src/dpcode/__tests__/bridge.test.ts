import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool'
import { assembleToolPool } from '../../tools'
import {
  applyDpcodeToolPermissionPolicy,
  shouldDenyBashForDpcodeWindows,
} from '../bridge'

describe('DP Code CCB bridge tool permission policy', () => {
  test('denies Bash on Windows by default', () => {
    const context = applyDpcodeToolPermissionPolicy(
      getEmptyToolPermissionContext(),
      {},
      'win32',
    )

    expect(context.alwaysDenyRules.session).toContain('Bash')
  })

  test('does not inject the Bash deny rule when the escape hatch is enabled', () => {
    const context = applyDpcodeToolPermissionPolicy(
      getEmptyToolPermissionContext(),
      { DPCODE_CCB_KEEP_BASH_ON_WINDOWS: '1' },
      'win32',
    )

    expect(context.alwaysDenyRules.session).toBeUndefined()
    expect(
      shouldDenyBashForDpcodeWindows(
        { DPCODE_CCB_KEEP_BASH_ON_WINDOWS: '1' },
        'win32',
      ),
    ).toBe(false)
  })

  test('assembleToolPool respects the DP Code Windows deny rule', () => {
    const context = applyDpcodeToolPermissionPolicy(
      getEmptyToolPermissionContext(),
      {},
      'win32',
    )
    const previousPowerShellFlag = process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1'

    try {
      const toolNames = assembleToolPool(context, []).map(tool => tool.name)
      expect(toolNames).not.toContain('Bash')
      if (process.platform === 'win32') {
        expect(toolNames).toContain('PowerShell')
      }
    } finally {
      if (previousPowerShellFlag === undefined) {
        delete process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL
      } else {
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = previousPowerShellFlag
      }
    }
  })
})
