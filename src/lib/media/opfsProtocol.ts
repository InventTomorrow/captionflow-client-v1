/**
 * Message contract between localMedia.ts (main thread) and opfs.worker.ts.
 * Types only — kept out of the worker file so the app's DOM-lib project never
 * pulls the worker's WebWorker-lib code into its type-check.
 */

export type OpfsRequest =
  | { id: number; op: 'write'; path: string; blob: Blob }
  | { id: number; op: 'remove'; path: string }
  | { id: number; op: 'stat'; path: string }
  | { id: number; op: 'list'; path: string };

export type OpfsReply =
  | { id: number; kind: 'ok'; result?: unknown }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'progress'; written: number; total: number };
