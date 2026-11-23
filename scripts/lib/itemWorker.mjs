// Worker threads need their own loader for the TypeScript and JSON island modules.
import { register } from 'tsx/esm/api';
import { parentPort, workerData } from 'node:worker_threads';

register();
const { executeItemSimJob } = await import('../itemSim.ts');
parentPort.postMessage(workerData.map(executeItemSimJob));
