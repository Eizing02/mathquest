import { ContractError, tokenPattern, validatePairRequest, validateScoreEvent } from './scansob-contract.mjs';
export async function sha256(value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function deliveryToken(key, body) {
  const imported = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = JSON.stringify(['mq-scansob-v1', body.request_id, body.source_workspace_id, body.request_secret]);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function response(status, body, retry) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(retry ? { 'Retry-After': String(retry) } : {}) } });
}
async function readBody(request, limit) {
  if (!request.body) throw new ContractError('INVALID_SCHEMA');
  const reader = request.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new ContractError('BODY_TOO_LARGE'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let cursor = 0;
  for (const part of parts) { bytes.set(part, cursor); cursor += part.length; }
  return bytes;
}
export function createScanSobHandler(kind, { rpc, pairingKey = '' }) {
  return async request => {
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return response(415, { error: 'JSON_REQUIRED' });
    try {
      const bytes = await readBody(request, kind === 'scores' ? 262144 : 8192);
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ContractError('INVALID_JSON'); }
      const authorization = request.headers.get('authorization') || '';
      const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      let result; let token;
      if (kind === 'scores') {
        if (!tokenPattern.test(bearer)) return response(401, { error: 'UNAUTHORIZED' });
        validateScoreEvent(body);
        result = await rpc('mq_scansob_ingest', { p_payload: body, p_raw_hash: await sha256(bytes), p_token_hash: await sha256(bearer) });
      } else {
        validatePairRequest(body);
        if (!pairingKey || pairingKey.length < 32) return response(503, { error: 'PAIRING_NOT_CONFIGURED' });
        token = body.request_secret ? await deliveryToken(pairingKey, body) : '';
        result = await rpc('mq_scansob_pair', {
          p_action: body.action, p_request_id: body.request_id, p_workspace_id: body.source_workspace_id,
          p_request_hash: body.request_secret ? await sha256(body.request_secret) : '',
          p_code_hash: body.pairing_code ? await sha256(body.pairing_code.toUpperCase()) : '',
          p_workspace_label: body.workspace_label || '', p_delivery_hash: token ? await sha256(token) : '',
          p_connection_id: body.connection_id || null, p_bearer_hash: tokenPattern.test(bearer) ? await sha256(bearer) : ''
        });
      }
      if (!result || !Number.isInteger(result.http_status) || result.http_status < 200 || result.http_status > 599 || !result.body) throw new Error('INVALID_DATABASE_RESPONSE');
      if (kind === 'pair' && result.http_status === 200 && result.body.status === 'active') {
        if (!token || !result.body.connection) throw new Error('INVALID_DELIVERY');
        result.body.connection.token = token;
      }
      return response(result.http_status, result.body, result.retry_after);
    } catch (error) {
      if (error instanceof ContractError) return response(error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: error.message });
      return response(503, { error: 'TEMPORARILY_UNAVAILABLE' });
    }
  };
}
export function serviceRpc(url, serviceKey) {
  return async (name, args) => {
    if (!url || !serviceKey) throw new Error('SERVICE_NOT_CONFIGURED');
    const result = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!result.ok) throw new Error('DATABASE_UNAVAILABLE');
    return result.json();
  };
}
