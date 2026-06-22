import type { SupabaseClient } from '@supabase/supabase-js'

// Counts rows per document_id for a tenant, used to show "N facts extracted"
// as a completeness signal in the Documents/Training UI. Paginated the same
// way training/page.tsx's chunkMap is — an unbounded select caps at 1000
// rows, which would silently undercount documents with many facts.
export async function buildFactCountMap(
  service: SupabaseClient,
  table: 'financial_facts' | 'document_facts',
  tenantId: string,
): Promise<Map<string, number>> {
  const PAGE_SIZE = 1000
  const counts = new Map<string, number>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await service
      .from(table)
      .select('document_id')
      .eq('tenant_id', tenantId)
      .range(from, from + PAGE_SIZE - 1)
    if (!page?.length) break
    for (const row of page as { document_id: string }[]) {
      counts.set(row.document_id, (counts.get(row.document_id) ?? 0) + 1)
    }
    if (page.length < PAGE_SIZE) break
  }
  return counts
}
