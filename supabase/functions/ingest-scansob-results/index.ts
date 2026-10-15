import { createScanSobHandler, serviceRpc } from '../_shared/scansob-http.mjs';
Deno.serve(createScanSobHandler('scores', {
  rpc: serviceRpc(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
}));
