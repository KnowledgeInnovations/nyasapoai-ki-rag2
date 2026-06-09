// Run once: node scripts/seed-staff.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const envContent = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
const env = {}
for (const line of envContent.split('\n')) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue
  const idx = line.indexOf('=')
  env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const EMAIL    = 'staff@knowledgeinnovations.com'
const PASSWORD = 'KnowledgeInnovStaff2026!'
const NAME     = 'Ama Mensah'   // Knowledge Innovations staff member

async function main() {
  console.log('Creating staff account...\n')

  // ── 1. Get tenant ────────────────────────────────────────
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('subdomain', 'knowledgeinnovations').maybeSingle()

  if (!tenant) throw new Error('Knowledge Innovations tenant not found. Run seed.mjs first.')
  console.log('Found tenant:', tenant.id)

  // ── 2. User ──────────────────────────────────────────────
  let userId
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const existing = users?.find(u => u.email === EMAIL)

  if (existing) {
    userId = existing.id
    console.log('Staff user already exists:', EMAIL)
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: NAME },
    })
    if (error) throw new Error('Auth: ' + error.message)
    userId = data.user.id
    console.log('Created user:', EMAIL)
  }

  // ── 3. Membership (junior = read-only, no upload) ────────
  const { data: existingMem } = await supabase
    .from('memberships').select('id')
    .eq('user_id', userId).eq('tenant_id', tenant.id).maybeSingle()

  if (existingMem) {
    console.log('Membership already exists')
  } else {
    const { error } = await supabase.from('memberships').insert({
      user_id: userId,
      tenant_id: tenant.id,
      role: 'junior',
    })
    if (error) throw new Error('Membership: ' + error.message)
    console.log('Created membership (role: junior)')
  }

  console.log('\n Done!\n')
  console.log('  Email:    ' + EMAIL)
  console.log('  Password: ' + PASSWORD)
  console.log('  Role:     junior (can chat, cannot upload documents)')
  console.log('\nSign in at http://localhost:3000/auth/login')
}

main().catch(err => { console.error('\nError:', err.message); process.exit(1) })
