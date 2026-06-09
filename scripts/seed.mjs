// Run once: node scripts/seed.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse .env.local
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

const EMAIL    = 'admin@knowledgeinnovations.com'
const PASSWORD = 'KnowledgeInnovAI2026!'

async function main() {
  console.log('Seeding Knowledge Innovations account...\n')

  // ── 1. User ──────────────────────────────────────────────
  let userId
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const existing = users?.find(u => u.email === EMAIL)

  if (existing) {
    userId = existing.id
    console.log('User already exists:', EMAIL)
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Knowledge Innovations Admin' },
    })
    if (error) throw new Error('Auth: ' + error.message)
    userId = data.user.id
    console.log('Created user:', EMAIL)
  }

  // ── 2. Tenant ────────────────────────────────────────────
  let tenantId
  const { data: existingTenant } = await supabase
    .from('tenants').select('id').eq('subdomain', 'knowledgeinnovations').maybeSingle()

  if (existingTenant) {
    tenantId = existingTenant.id
    console.log('Tenant already exists')
  } else {
    const { data, error } = await supabase.from('tenants').insert({
      name: 'Knowledge Innovations',
      subdomain: 'knowledgeinnovations',
      plan: 'enterprise',
    }).select('id').single()
    if (error) throw new Error('Tenant: ' + error.message)
    tenantId = data.id
    console.log('Created tenant: Knowledge Innovations')
  }

  // ── 3. Membership ────────────────────────────────────────
  const { data: existingMem } = await supabase
    .from('memberships').select('id')
    .eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle()

  if (existingMem) {
    console.log('Membership already exists')
  } else {
    const { error } = await supabase.from('memberships').insert({
      user_id: userId,
      tenant_id: tenantId,
      role: 'senior',
    })
    if (error) throw new Error('Membership: ' + error.message)
    console.log('Created membership (role: senior)')
  }

  console.log('\n Done!\n')
  console.log('  Email:    ' + EMAIL)
  console.log('  Password: ' + PASSWORD)
  console.log('\nYou can now sign in at http://localhost:3000/auth/login')
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
