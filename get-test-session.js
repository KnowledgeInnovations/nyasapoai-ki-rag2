const fs = require('fs');
const env = {};
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
});
const { createClient } = require('@supabase/supabase-js');

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// busicrys@gmail.com is a senior member of the Knowledge Innovations tenant.
// (admin@knowledgeinnovations.com no longer has a membership row — a session
// for it bounces to /auth/setup-workspace.)
const EMAIL = 'busicrys@gmail.com';

(async () => {
  // type 'recovery', not 'magiclink' — magiclink token hashes are rejected
  // ("Email link is invalid or has expired", likely consumed/invalidated by
  // the Send Email Hook flow); recovery-type links verify fine.
  const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({ type: 'recovery', email: EMAIL });
  if (linkErr) { console.error('LINK_ERROR', linkErr.message); process.exit(1); }
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) { console.error('NO_TOKEN_HASH', JSON.stringify(linkData)); process.exit(1); }

  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (otpErr) { console.error('OTP_ERROR', otpErr.message); process.exit(1); }

  const session = otpData.session;
  const projectRef = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1];
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  })).toString('base64');

  const cookieName = `sb-${projectRef}-auth-token`;
  fs.writeFileSync('test-session-cookie.txt', `${cookieName}=${cookieValue}`);
  console.log('OK cookie length:', cookieValue.length, 'name:', cookieName);
  console.log('user:', session.user.email);
})();
