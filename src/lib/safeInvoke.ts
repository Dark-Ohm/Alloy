// ── Tauri invoke wrapper with structured error handling ────────────────

import { invoke } from '@tauri-apps/api/core'
import { formatAlloyError, type AlloyError, type AlloyResult } from '@/types/error'

/**
 * Invoke a Tauri command and automatically handle AlloyError.
 * 
 * On success, returns the actual value T.
 * On error, throws a formatted string error that includes all error context,
 * suitable for direct display in the error banner.
 * 
 * Usage:
 *   const deps = await safeInvoke<SystemDeps>('check_system_deps')
 *   // or with args:
 *   const result = await safeInvoke<InstallResult>('execute_installation', { cmdId, path })
 * 
 * Errors thrown by this function are strings formatted like:
 * "CommandFailed: Build failed: ... | exit code: 1 | stderr: ..."
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    // The backend now returns AlloyResult<T>, which Tauri serializes
    // We need to check if it's an error result
    const result = await invoke<AlloyResult<T>>(command, args)
    
    if (result.ok) {
      return result.value
    } else {
      // Format the structured error and throw as string for existing error handling
      throw new Error(formatAlloyError(result.error))
    }
  } catch (e: unknown) {
    // If it's already our formatted error, rethrow
    const message = e instanceof Error ? e.message : String(e)
    if (isFormattedAlloyError(message)) {
      throw e
    }
    // Otherwise it might be a Tauri transport error or other - format it
    throw new Error(`Internal: ${message}`)
  }
}

function isFormattedAlloyError(message: string): boolean {
  const prefixes = [
    'Io:', 'Fs:', 'Json:', 'Parse:', 'Conversion:', 'CommandFailed:',
    'InvalidPackage:', 'PermissionDenied:', 'NotFound:', 'Internal:', 'SudoRequired:'
  ]
  return prefixes.some(p => message.startsWith(p))
}

/**
 * Invoke a command that returns void (unit type).
 * Returns true on success, throws formatted error on failure.
 */
export async function safeInvokeVoid(
  command: string,
  args?: Record<string, unknown>
): Promise<void> {
  await safeInvoke<void>(command, args)
}

export { formatAlloyError }
export type { AlloyError, AlloyResult }