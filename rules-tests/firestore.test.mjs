import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'sign-mesh-maker-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const alice = env.authenticatedContext(ALICE).firestore();
const bob = env.authenticatedContext(BOB).firestore();
const anon = env.unauthenticatedContext().firestore();

const project = (ownerUid = ALICE, overrides = {}) => ({
  ownerUid,
  name: 'Bathtub sign',
  svg: '<svg/>',
  thumbnailDataUrl: 'data:image/jpeg;base64,AAAA',
  config: { widthMm: 120, baseMm: 2, layerMm: 0.4, layers: [] },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/** Plants a document directly, bypassing rules, to set up a scenario. */
async function seed(id, data) {
  await env.withSecurityRulesDisabled(async (ctx) =>
    setDoc(doc(ctx.firestore(), 'projects', id), data),
  );
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', `${name} — ${error.message.split('\n')[0]}`]);
  }
}

await check('owner can create their own project', async () => {
  await assertSucceeds(setDoc(doc(alice, 'projects', 'p1'), project()));
});

await check('cannot create a project owned by someone else', async () => {
  await assertFails(setDoc(doc(alice, 'projects', 'p2'), project(BOB)));
});

await check('anonymous cannot create', async () => {
  await assertFails(setDoc(doc(anon, 'projects', 'p3'), project()));
});

await check('owner can read their own project', async () => {
  await seed('p10', project());
  await assertSucceeds(getDoc(doc(alice, 'projects', 'p10')));
});

await check('another user cannot read it', async () => {
  await seed('p11', project());
  await assertFails(getDoc(doc(bob, 'projects', 'p11')));
});

// The vulnerability: `allow update` tested only the existing document's owner,
// so an owner could hand their document to somebody else's project list.
await check('owner CANNOT reassign ownerUid to another user', async () => {
  await seed('p20', project());
  await assertFails(updateDoc(doc(alice, 'projects', 'p20'), { ownerUid: BOB }));
});

await check('owner can still rename', async () => {
  await seed('p21', project());
  await assertSucceeds(updateDoc(doc(alice, 'projects', 'p21'), { name: 'Renamed' }));
});

await check('another user cannot update', async () => {
  await seed('p22', project());
  await assertFails(updateDoc(doc(bob, 'projects', 'p22'), { name: 'Stolen' }));
});

await check('owner can delete, others cannot', async () => {
  await seed('p30', project());
  await assertFails(deleteDoc(doc(bob, 'projects', 'p30')));
  await assertSucceeds(deleteDoc(doc(alice, 'projects', 'p30')));
});

await check('rejects an oversized svg', async () => {
  await assertFails(
    setDoc(doc(alice, 'projects', 'p40'), project(ALICE, { svg: 'x'.repeat(900_001) })),
  );
});

await check('rejects a thumbnail that is not inline image data', async () => {
  await assertFails(
    setDoc(
      doc(alice, 'projects', 'p41'),
      project(ALICE, { thumbnailDataUrl: 'https://evil.example/track.gif' }),
    ),
  );
});

await check('rejects unexpected fields', async () => {
  await assertFails(
    setDoc(doc(alice, 'projects', 'p42'), project(ALICE, { injected: 'payload' })),
  );
});

await check('rejects an over-long name', async () => {
  await assertFails(
    setDoc(doc(alice, 'projects', 'p43'), project(ALICE, { name: 'n'.repeat(201) })),
  );
});

await check('users doc is private to its owner', async () => {
  await assertSucceeds(
    setDoc(doc(alice, 'users', ALICE), { displayName: 'A', email: 'a@x', photoURL: '', createdAt: new Date() }),
  );
  await assertFails(setDoc(doc(bob, 'users', ALICE), { displayName: 'B' }));
});

await check('other collections stay closed', async () => {
  await assertFails(setDoc(doc(alice, 'secrets', 's1'), { x: 1 }));
});

await env.cleanup();
for (const [status, name] of results) console.log(`  ${status}  ${name}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
