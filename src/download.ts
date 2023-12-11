import { createRegistry, createRequest, applyParams } from "@substreams/core";
import { readPackage } from "@substreams/manifest";
import { BlockEmitter, createNodeTransport } from "@substreams/node";
import { token, baseUrl, manifest, outputModule, params, startBlockNum, stopBlockNum } from "./config.js";
import { readCursor, saveCursor } from "./utils.js";
import fs from "fs";
import { toTransactionId } from "./evm.js";

// Read Substream
const substreamPackage = await readPackage(manifest);
if ( !substreamPackage.modules ) throw new Error("No modules found in manifest");
applyParams([params], substreamPackage.modules.modules);

// Connect Transport
const registry = createRegistry(substreamPackage);
const transport = createNodeTransport(baseUrl, token, registry);
const request = createRequest({
  substreamPackage,
  outputModule,
  startBlockNum,
  stopBlockNum,
  startCursor: readCursor(),
});

// NodeJS Events
const emitter = new BlockEmitter(transport, request, registry);

export interface Download {
  evm_trx_id: string;
  eos_trx_id: string;
  eos_block_number: number;
  timestamp: string;
  miner: string;
  rlptx: string;
}

// Stream Blocks
const writer = fs.createWriteStream("pushtx.jsonl", {flags: "a"});
emitter.on("anyMessage", (message: any, cursor, clock) => {
  if (!message.transactionTraces) return;
  for ( const trace of message.transactionTraces ) {
    if ( !trace.actionTraces ) continue;
    for ( const action of trace.actionTraces) {
      if ( action.action.name !== "pushtx" ) continue;
      const { miner, rlptx } = JSON.parse(action.action.jsonData);
      const row: Download = {
        evm_trx_id: toTransactionId(`0x${rlptx}`),
        eos_trx_id: trace.id,
        eos_block_number: trace.blockNum,
        timestamp: trace.blockTime,
        miner,
        rlptx,
      }
      writer.write(JSON.stringify(row) + "\n");
    }
  }
});

emitter.on("cursor", (cursor) => {
  saveCursor(cursor);
});

// End of Stream
emitter.on("close", (error) => {
  if (error) {
    console.error(error);
  }
});

// Fatal Error
emitter.on("fatalError", (error) => {
  console.error(error);
});

emitter.start();