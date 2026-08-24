/**
 * Theme discovery for the single, self-organizing dashboard (replacing the
 * 8 fixed department dashboards — Sales/Marketing/HR/Finance/Executive/
 * Development/Client-Service/Communications — which assumed every tenant
 * maps onto that exact conventional org chart; most don't).
 *
 * Instead of asking an admin to configure which departments/metrics apply,
 * this looks at what the tenant's OWN documents actually cover — their
 * inventory and a sample of already-extracted facts — and asks Claude to
 * name the real themes present (property investment returns, SOP
 * compliance, whatever actually shows up), each with a small set of
 * concrete insight questions grounded in real entities from the sample.
 * Cached per tenant (dashboard_themes_cache) since this is one AI call
 * that shouldn't re-run on every page load — refreshed on demand or when
 * stale.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { claudeComplete } from './claude'

export interface DashboardInsightQuestion {
  label: string
  question: string
}

export interface DashboardTheme {
  title: string
  description: string
  insights: DashboardInsightQuestion[]
}

const THEME_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MIN_THEMES = 2
const MAX_THEMES = 6

const THEME_SYSTEM_PROMPT = `You analyze a business's document inventory and a sample of facts already extracted from those documents, then identify the REAL topical themes this business's data actually supports — not a generic department template (do NOT default to "Sales/Marketing/HR/Finance" unless the documents genuinely show that structure).

Produce 3 to 5 themes. Each theme needs:
- "title": a short (2-4 word) name for the theme, in the business's own terminology.
- "description": one sentence on what this theme covers.
- "insights": 2-3 questions a business dashboard should show live AI-generated answers to for this theme, each with a short "label" (2-4 words) and the full "question" text. Every question must be answerable from real, specific entities/subjects/documents in the sample data below — ground each one in something real, not a generic template question.

Cover the business broadly across the themes (don't produce 5 near-duplicate financial themes if the documents also cover operations, compliance, HR, etc.) — but only surface themes the sample data actually supports.

Respond ONLY with a JSON array of theme objects: [{"title": "...", "description": "...", "insights": [{"label": "...", "question": "..."}, ...]}, ...]`

interface RawTheme {
  title?: string
  description?: string
  insights?: { label?: string; question?: string }[]
}

function isValidTheme(t: RawTheme): t is { title: string; description: string; insights: { label: string; question: string }[] } {
  return typeof t.title === 'string' && t.title.trim().length > 0
    && typeof t.description === 'string'
    && Array.isArray(t.insights) && t.insights.length > 0
    && t.insights.every(i => typeof i?.label === 'string' && typeof i?.question === 'string' && i.question.trim().length > 0)
}

async function generateThemes(
  svc: SupabaseClient, tenantId: string, orgName: string, orgDescription: string,
): Promise<DashboardTheme[] | null> {
  const { data: docs } = await svc
    .from('documents')
    .select('title, department')
    .eq('tenant_id', tenantId)
    .eq('status', 'ready')
    .limit(50)
  if (!docs?.length) return null

  const [{ data: financialSample }, { data: docFactSample }] = await Promise.all([
    svc.from('financial_facts')
      .select('fiscal_year, entity, entity_type, metric, value, unit')
      .eq('tenant_id', tenantId)
      .gte('confidence', 70)
      .order('fiscal_year', { ascending: false })
      .limit(25),
    svc.from('document_facts')
      .select('subject, attribute, value_text, unit, category')
      .eq('tenant_id', tenantId)
      .gte('confidence', 70)
      .limit(60),
  ])

  const inventoryText = docs.map(d => `- ${d.title}${d.department ? ` [${d.department}]` : ''}`).join('\n')
  const factsText = financialSample?.length
    ? 'SAMPLE VALIDATED FACTS (financial_facts):\n' + financialSample
        .map(f => `- ${f.entity} — ${f.metric} (${f.fiscal_year ?? 'no year'}): ${f.value} ${f.unit}`)
        .join('\n')
    : docFactSample?.length
    ? 'SAMPLE EXTRACTED FACTS (document_facts):\n' + docFactSample
        .map(f => `- [${f.category ?? 'general'}] ${f.subject} — ${f.attribute}: ${f.value_text}${f.unit ? ` ${f.unit}` : ''}`)
        .join('\n')
    : ''
  if (!factsText) return null

  try {
    const raw = await claudeComplete({
      temperature: 0.3,
      maxTokens: 2500,
      system: THEME_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Business: ${orgName} — ${orgDescription}\n\nDOCUMENT INVENTORY:\n${inventoryText}\n\n${factsText}`,
      }],
    })
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as RawTheme[]
    if (!Array.isArray(parsed)) return null
    const valid = parsed.filter(isValidTheme).slice(0, MAX_THEMES)
    if (valid.length < MIN_THEMES) return null
    return valid.map(t => ({
      title: t.title,
      description: t.description,
      insights: t.insights.map(i => ({ label: i.label, question: i.question })),
    }))
  } catch (e) {
    console.error('[DashboardThemes] generation failed:', e)
    return null
  }
}

// Cache-through wrapper: returns cached themes if fresh, otherwise generates,
// caches, and returns. `forceRefresh` skips the cache read (still writes the
// new result). Returns null (not a throw) when generation itself fails or
// this tenant genuinely has nothing to build themes from yet — the caller
// decides what "no themes yet" should look like in the UI.
export async function getDashboardThemes(
  svc: SupabaseClient, tenantId: string, orgName: string, orgDescription: string,
  forceRefresh = false,
): Promise<DashboardTheme[] | null> {
  if (!forceRefresh) {
    const { data: cached } = await svc
      .from('dashboard_themes_cache')
      .select('themes, generated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (cached && Date.now() - new Date(cached.generated_at).getTime() < THEME_CACHE_TTL_MS) {
      return cached.themes as DashboardTheme[]
    }
  }

  const themes = await generateThemes(svc, tenantId, orgName, orgDescription)
  if (!themes) return null

  const { error } = await svc.from('dashboard_themes_cache').upsert({
    tenant_id: tenantId, themes, generated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) console.error('[DashboardThemes] cache upsert failed:', error)

  return themes
}
