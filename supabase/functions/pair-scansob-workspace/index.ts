import { createScanSobHandler, serviceRpc } from '../_shared/scansob-http.mjs';
Deno.serve(createScanSobHandler('pair', {
  rpc: serviceRpc(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
  pairingKey: Deno.env.get('SCANSOB_PAIRING_DELIVERY_KEY'),
  signingKey: Deno.env.get('SCANSOB_CODE_FREE_SIGNING_KEY'),
  signingKeyId: Deno.env.get('SCANSOB_CODE_FREE_SIGNING_KEY_ID'),
  signingSchoolId: Deno.env.get('SCANSOB_CODE_FREE_DESTINATION_ID')
}));
