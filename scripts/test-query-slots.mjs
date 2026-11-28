// Unit tests for lib/query-slots.ts (the per-app queue in front of the query role's CONNECTION LIMIT).
// Run: node --test scripts/test-query-slots.mjs   (Node >= 23.6 strips the TypeScript types itself)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QuerySlotQueueFullError,
  QuerySlotTimeoutError,
  acquireQuerySlot,
  querySlotState,
} from '../lib/query-slots.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('grants up to the limit at once and queues the rest', async () => {
  const k = 'app_t1';
  const r1 = await acquireQuerySlot(k, 2, 1000, 10);
  const r2 = await acquireQuerySlot(k, 2, 1000, 10);
  let third = false;
  const p3 = acquireQuerySlot(k, 2, 1000, 10).then((r) => { third = true; return r; });
  await sleep(10);
  assert.equal(third, false, 'third request must wait');
  assert.deepEqual(querySlotState(k), { active: 2, waiting: 1 });
  r1();
  const r3 = await p3;
  assert.equal(third, true);
  assert.deepEqual(querySlotState(k), { active: 2, waiting: 0 }, 'slot handed over, not freed');
  r2(); r3();
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 }, 'idle gate is dropped');
});

test('waiters are served in arrival order', async () => {
  const k = 'app_t2';
  const first = await acquireQuerySlot(k, 1, 1000, 10);
  const order = [];
  const ps = [1, 2, 3].map((i) => acquireQuerySlot(k, 1, 1000, 10).then((r) => { order.push(i); return r; }));
  first();
  for (const p of ps) (await p)();
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 });
});

test('a waiter times out and leaves the queue', async () => {
  const k = 'app_t3';
  const held = await acquireQuerySlot(k, 1, 1000, 10);
  await assert.rejects(acquireQuerySlot(k, 1, 40, 10), QuerySlotTimeoutError);
  assert.deepEqual(querySlotState(k), { active: 1, waiting: 0 });
  held();
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 });
});

test('the queue is bounded', async () => {
  const k = 'app_t4';
  const held = await acquireQuerySlot(k, 1, 1000, 1);
  const waiting = acquireQuerySlot(k, 1, 1000, 1);
  await assert.rejects(acquireQuerySlot(k, 1, 1000, 1), QuerySlotQueueFullError);
  held();
  (await waiting)();
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 });
});

test('calling release twice does not free a second slot', async () => {
  const k = 'app_t5';
  const r1 = await acquireQuerySlot(k, 1, 1000, 10);
  r1(); r1();
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 });
  const r2 = await acquireQuerySlot(k, 1, 1000, 10);
  const r3p = acquireQuerySlot(k, 1, 1000, 10);
  r1(); // stale release from an earlier request: ignored
  assert.deepEqual(querySlotState(k), { active: 1, waiting: 1 });
  r2();
  (await r3p)();
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 });
});

test('apps do not share slots', async () => {
  const a = await acquireQuerySlot('app_ta', 1, 1000, 10);
  const b = await acquireQuerySlot('app_tb', 1, 1000, 10); // would wait if gates were shared
  assert.deepEqual(querySlotState('app_ta'), { active: 1, waiting: 0 });
  a(); b();
});

test('a CourtLibrary-sized burst (70 queries, limit 10) all succeed and never exceed 10 at once', async () => {
  const k = 'app_burst';
  let now = 0, peak = 0, done = 0;
  await Promise.all(Array.from({ length: 70 }, async () => {
    const release = await acquireQuerySlot(k, 10, 5000, 500);
    now += 1; peak = Math.max(peak, now);
    await sleep(5);
    now -= 1; done += 1;
    release();
  }));
  assert.equal(done, 70);
  assert.ok(peak <= 10, `peak ${peak} > 10`);
  assert.equal(peak, 10);
  assert.deepEqual(querySlotState(k), { active: 0, waiting: 0 });
});
