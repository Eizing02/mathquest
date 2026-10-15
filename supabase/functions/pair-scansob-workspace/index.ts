import { createScanSobHandler, serviceRpc } from '../_shared/scansob-http.mjs';
Deno.serve(createScanSobHandler('pair', {
  rpc: serviceRpc(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
  pairingKey: Deno.env.get('SCANSOB_PAIRING_DELIVERY_KEY')
}));
