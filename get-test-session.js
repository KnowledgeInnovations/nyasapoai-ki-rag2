const fs = require('fs');
const env = {};
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
});
const { createClient } = require('@supabase/supabase-js');

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const EMAIL = 'admin@knowledgeinnovations.com';

(async () => {
  const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  if (linkErr) { console.error('LINK_ERROR', linkErr.message); process.exit(1); }
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) { console.error('NO_TOKEN_HASH', JSON.stringify(linkData)); process.exit(1); }

  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
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
