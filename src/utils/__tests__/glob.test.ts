import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../Tool'
import { extractGlobBaseDirectory, glob } from '../glob'

describe('extractGlobBaseDirectory', () => {
  test('extracts base dir from glob with *', () => {
    const result = extractGlobBaseDirectory('src/utils/*.ts')
    expect(result.baseDir).toBe('src/utils')
    expect(result.relativePattern).toBe('*.ts')
  })

  test('extracts base dir from glob with **', () => {
    const result = extractGlobBaseDirectory('src/**/*.ts')
    expect(result.baseDir).toBe('src')
    expect(result.relativePattern).toBe('**/*.ts')
  })

  test('returns dirname for literal path', () => {
    const result = extractGlobBaseDirectory('src/utils/file.ts')
    expect(result.baseDir).toBe('src/utils')
    expect(result.relativePattern).toBe('file.ts')
  })

  test('handles glob starting with pattern', () => {
    const result = extractGlobBaseDirectory('*.ts')
    expect(result.baseDir).toBe('')
    expect(result.relativePattern).toBe('*.ts')
  })

  test('handles braces pattern', () => {
    const result = extractGlobBaseDirectory('src/{a,b}/*.ts')
    expect(result.baseDir).toBe('src')
    expect(result.relativePattern).toBe('{a,b}/*.ts')
  })

  test('handles question mark pattern', () => {
    const result = extractGlobBaseDirectory('src/?.ts')
    expect(result.baseDir).toBe('src')
    expect(result.relativePattern).toBe('?.ts')
  })
})

describe('glob', () => {
  test('respects gitignore when CLAUDE_CODE_GLOB_NO_IGNORE is false', async () => {
    const previousNoIgnore = process.env.CLAUDE_CODE_GLOB_NO_IGNORE
    const previousStreaming = process.env.CLAUDE_CODE_GLOB_STREAMING
    process.env.CLAUDE_CODE_GLOB_NO_IGNORE = 'false'
    process.env.CLAUDE_CODE_GLOB_STREAMING = 'true'

    try {
      const dir = await mkdtemp(join(tmpdir(), 'ccb-glob-'))
      await mkdir(join(dir, '.git'), { recursive: true })
      await writeFile(join(dir, '.gitignore'), 'node_modules\n')
      await writeFile(join(dir, 'package.json'), '{}')
      await mkdir(join(dir, 'node_modules'), { recursive: true })
      await writeFile(join(dir, 'node_modules', 'package.json'), '{}')

      const result = await glob(
        'package.json',
        dir,
        { limit: 10, offset: 0 },
        new AbortController().signal,
        getEmptyToolPermissionContext(),
      )

      expect(result.files).toEqual([join(dir, 'package.json')])
      expect(result.truncated).toBe(false)
    } finally {
      if (previousNoIgnore === undefined) {
        delete process.env.CLAUDE_CODE_GLOB_NO_IGNORE
      } else {
        process.env.CLAUDE_CODE_GLOB_NO_IGNORE = previousNoIgnore
      }
      if (previousStreaming === undefined) {
        delete process.env.CLAUDE_CODE_GLOB_STREAMING
      } else {
        process.env.CLAUDE_CODE_GLOB_STREAMING = previousStreaming
      }
    }
  })

  test('stops after enough streaming results for the requested page', async () => {
    const previousStreaming = process.env.CLAUDE_CODE_GLOB_STREAMING
    process.env.CLAUDE_CODE_GLOB_STREAMING = 'true'

    try {
      const dir = await mkdtemp(join(tmpdir(), 'ccb-glob-limit-'))
      await writeFile(join(dir, 'a.ts'), '')
      await writeFile(join(dir, 'b.ts'), '')
      await writeFile(join(dir, 'c.ts'), '')

      const result = await glob(
        '*.ts',
        dir,
        { limit: 2, offset: 0 },
        new AbortController().signal,
        getEmptyToolPermissionContext(),
      )

      expect(result.files).toHaveLength(2)
      expect(result.truncated).toBe(true)
    } finally {
      if (previousStreaming === undefined) {
        delete process.env.CLAUDE_CODE_GLOB_STREAMING
      } else {
        process.env.CLAUDE_CODE_GLOB_STREAMING = previousStreaming
      }
    }
  })
})
