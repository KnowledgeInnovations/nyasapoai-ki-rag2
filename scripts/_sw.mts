import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile(path.join(process.cwd(), '.env.local'))
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data } = await db.from('platform_settings').select('key, value, note, updated_at')
for (const r of data ?? []) console.log(`${r.key.padEnd(22)} ${String(r.value).padEnd(6)} ${r.updated_at}  ${r.note}`)
