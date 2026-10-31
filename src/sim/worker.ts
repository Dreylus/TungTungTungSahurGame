/// <reference lib="webworker" />
import type { ToWorker } from './protocol.ts';
import { Runner } from './runner.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const runner = new Runner((m, transfer) => ctx.postMessage(m, transfer ?? []));
ctx.onmessage = (e: MessageEvent<ToWorker>) => runner.handle(e.data);
runner.start();
