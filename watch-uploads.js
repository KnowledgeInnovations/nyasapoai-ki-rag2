const fs = require('fs');
const env = {};
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
});
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const POLL_MS = 60000;
const STABLE_ROUNDS_NEEDED = 5; // ~5 minutes of no change + nothing processing
let lastSnapshot = null;
let stableRounds = 0;

async function poll() {
  const { data, error } = await svc.from('documents').select('id, title, status, created_at').order('created_at', { ascending: false });
  if (error) { console.log('POLL_ERROR ' + error.message); return; }

  const snapshot = data.map(d => `${d.id}:${d.status}`).sort().join(',');
  const processing = data.filter(d => d.status === 'processing');

  if (lastSnapshot === null) {
    console.log(`BASELINE count=${data.length} processing=${processing.length}`);
  } else if (snapshot !== lastSnapshot) {
    console.log(`CHANGE count=${data.length} processing=${processing.length} — ${data.slice(0, 3).map(d => `${d.status}:${d.title}`).join(' | ')}`);
    stableRounds = 0;
  } else if (processing.length > 0) {
    console.log(`STILL_PROCESSING count=${processing.length} — ${processing.map(d => d.title).join(', ')}`);
    stableRounds = 0;
  } else {
    stableRounds++;
    console.log(`STABLE round=${stableRounds}/${STABLE_ROUNDS_NEEDED} count=${data.length}`);
    if (stableRounds >= STABLE_ROUNDS_NEEDED) {
      console.log(`DONE count=${data.length} — uploads appear finished, no processing docs for ${STABLE_ROUNDS_NEEDED} rounds`);
      process.exit(0);
    }
  }
  lastSnapshot = snapshot;
}

(async () => {
  while (true) {
    await poll();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
