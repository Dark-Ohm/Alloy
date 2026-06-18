// ── AlloyError types mirroring Rust AlloyError enum ────────────────────

export type AlloyErrorKind =
  | 'Io'
  | 'Fs'
  | 'Json'
  | 'Parse'
  | 'Conversion'
  | 'CommandFailed'
  | 'InvalidPackage'
  | 'PermissionDenied'
  | 'NotFound'
  | 'Internal'
  | 'SudoRequired';

/**
 * Structured error matching the Rust `AlloyError` enum.
 * All variants have a `message` field and some have additional context.
 */
export interface AlloyError {
  kind: AlloyErrorKind;
  message: string;
  // Optional context fields for specific error variants
  path?: string;
  exitCode?: number;
  stderr?: string;
  source?: string;
}

/**
 * Result type for Tauri commands - matches Rust `AlloyResult<T>`
 */
export type AlloyResult<T> = { ok: true; value: T } | { ok: false; error: AlloyError };

/**
 * Type guard to check if a result is an error
 */
export function isAlloyError<T>(result: AlloyResult<T>): result is { ok: false; error: AlloyError } {
  return !result.ok;
}

/**
 * Type guard to check if a result is successful
 */
export function isAlloyOk<T>(result: AlloyResult<T>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Extract the value from a successful result, throwing if it's an error
 */
export function unwrapAlloyResult<T>(result: AlloyResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`${result.error.kind}: ${result.error.message}`);
}

/**
 * Format an AlloyError for display in UI
 */
export function formatAlloyError(error: AlloyError): string {
  const parts = [error.kind, error.message];
  if (error.path) parts.push(`path: ${error.path}`);
  if (error.exitCode !== undefined) parts.push(`exit code: ${error.exitCode}`);
  if (error.stderr) parts.push(`stderr: ${error.stderr}`);
  if (error.source) parts.push(`source: ${error.source}`);
  return parts.join(' | ');
}