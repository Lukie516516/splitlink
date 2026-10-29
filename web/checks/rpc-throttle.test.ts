import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeRpcThrottle} from '../src/lib/rpcThrottle';
test('public RPC calls serialize and do not overlap',async()=>{
 let active=0,peak=0,calls=0;
 const f=makeRpcThrottle(async()=>{active++;peak=Math.max(peak,active);calls++;await new Promise(r=>setTimeout(r,3));active--;return new Response('{"result":"0x"}');},1,1000);
 await Promise.all([f('https://example.test'),f('https://example.test'),f('https://example.test')]);
 assert.equal(calls,3);assert.equal(peak,1);
});
test('JSON RPC rate limit blocks queued retries without treating failed read as valid',async()=>{
 let calls=0;
 const f=makeRpcThrottle(async()=>{calls++;return new Response('{"error":{"message":"rate limit exceeded"}}');},0,60000);
 await assert.rejects(f('https://example.test'),/rate limit/);
 await assert.rejects(f('https://example.test'),/rate limit/);
 assert.equal(calls,1);
});
