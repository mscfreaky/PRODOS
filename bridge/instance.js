import { setTimeout as delay } from 'node:timers/promises';

export async function attachExisting(owner, { demo, host }) {
  if (!owner?.nonce || owner.version !== '1.0.0' || !Number.isInteger(owner.port) || owner.port < 1 || owner.port > 65535) return false;
  if (owner.demo !== demo || (!demo && owner.host !== host)) {
    throw new Error('A suite with a different mode or ATEM IP address is using this data store. Close that instance first.');
  }
  const base = `http://127.0.0.1:${owner.port}`;
  async function verify() {
    const response = await fetch(base + '/instance', { headers: { 'X-Instance-Key': owner.nonce }, signal: AbortSignal.timeout(1800) });
    if (!response.ok) throw new Error('The existing suite is unreachable. Close the other suite window and restart.');
    const info = await response.json();
    if (info.pid !== owner.pid || info.version !== owner.version || info.demo !== demo || info.host !== (host || null)) throw new Error('Could not verify the existing suite identity.');
  }
  await verify();
  console.log('ATTACHED Using the existing PRODOS instance. Disconnect closes only this connection.');
  console.log(`READY ${owner.port}`);
  console.log(`PRODUCTION ${base}/production`);
  // This process owns no data or tunnel. The original process remains their owner.
  try { while (true) { await delay(2000); await verify(); } }
  catch { console.error('The connected PRODOS instance has exited. Please reconnect.'); }
  return true;
}
