import { basename, dirname, isAbsolute, join, sep } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { getGlobExclusionsForPluginCache } from './plugins/orphanedPluginFilter.js'
import { ripGrep, ripGrepStream } from './ripgrep.js'

/**
 * Extracts the static base directory from a glob pattern.
 * The base directory is everything before the first glob special character (* ? [ {).
 * Returns the directory portion and the remaining relative pattern.
 */
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  // Find the first glob special character: *, ?, [, {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    // No glob characters - this is a literal path
    // Return the directory portion and filename as pattern
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  // Get everything before the first glob character
  const staticPrefix = pattern.slice(0, match.index)

  // Find the last path separator in the static prefix
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    // No path separator before the glob - pattern is relative to cwd
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  // Handle root directory patterns (e.g., /*.txt on Unix or C:/*.txt on Windows)
  // When lastSepIndex is 0, baseDir is empty but we need to use '/' as the root
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  // Handle Windows drive root paths (e.g., C:/*.txt)
  // 'C:' means "current directory on drive C" (relative), not root
  // We need 'C:/' or 'C:\' for the actual drive root
  if (getPlatform() === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.includes('aborted'))
  )
}

async function ripGrepFilesBounded(
  args: string[],
  target: string,
  offset: number,
  limit: number,
  abortSignal: AbortSignal,
): Promise<{ paths: string[]; truncated: boolean }> {
  const needed = offset + limit + 1
  const paths: string[] = []
  const controller = new AbortController()
  let stoppedAfterLimit = false

  const abort = () => controller.abort(abortSignal.reason)
  if (abortSignal.aborted) {
    abort()
  } else {
    abortSignal.addEventListener('abort', abort, { once: true })
  }

  try {
    await ripGrepStream(args, target, controller.signal, lines => {
      for (const line of lines) {
        if (!line) continue
        paths.push(line)
        if (paths.length >= needed) {
          stoppedAfterLimit = true
          controller.abort()
          break
        }
      }
    })
  } catch (error) {
    if (!stoppedAfterLimit || !isAbortError(error)) {
      throw error
    }
  } finally {
    abortSignal.removeEventListener('abort', abort)
  }

  return {
    paths: paths.slice(offset, offset + limit),
    truncated: stoppedAfterLimit || paths.length > offset + limit,
  }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
): Promise<{ files: string[]; truncated: boolean }> {
  let searchDir = cwd
  let searchPattern = filePattern

  // Handle absolute paths by extracting the base directory and converting to relative pattern
  // ripgrep's --glob flag only works with relative patterns
  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(toolPermissionContext),
    searchDir,
  )

  // Use ripgrep for better memory performance
  // --files: list files instead of searching content
  // --glob: filter by pattern
  // --sort=modified: sort by modification time (oldest first)
  // --no-ignore: don't respect .gitignore (default true, set CLAUDE_CODE_GLOB_NO_IGNORE=false to respect .gitignore)
  // --hidden: include hidden files (default true, set CLAUDE_CODE_GLOB_HIDDEN=false to exclude)
  // Note: use || instead of ?? to treat empty string as unset (defaulting to true)
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true')
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true')
  const streaming = isEnvTruthy(
    process.env.CLAUDE_CODE_GLOB_STREAMING || 'true',
  )
  const args = [
    '--files',
    '--glob',
    searchPattern,
    ...(streaming ? [] : ['--sort=modified']),
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  // Add ignore patterns
  for (const pattern of ignorePatterns) {
    args.push('--glob', `!${pattern}`)
  }

  // Exclude orphaned plugin version directories
  for (const exclusion of await getGlobExclusionsForPluginCache(searchDir)) {
    args.push('--glob', exclusion)
  }

  const { paths, truncated } = streaming
    ? await ripGrepFilesBounded(args, searchDir, offset, limit, abortSignal)
    : {
        paths: await ripGrep(args, searchDir, abortSignal),
        truncated: false,
      }

  // ripgrep returns relative paths, convert to absolute
  const absolutePaths = paths.map(p => (isAbsolute(p) ? p : join(searchDir, p)))

  const files = streaming
    ? absolutePaths
    : absolutePaths.slice(offset, offset + limit)

  return {
    files,
    truncated: streaming ? truncated : absolutePaths.length > offset + limit,
  }
}
