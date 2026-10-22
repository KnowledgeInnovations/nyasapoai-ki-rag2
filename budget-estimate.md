# Nyansa AI — Monthly AI API Budget Estimate

**Basis:** Claude (Anthropic) + OpenAI API usage, estimated per tenant assuming regular daily use (~60 questions/day per tenant). This is a planning estimate based on typical per-question API costs (embedding, retrieval reranking, answer verification, and AI answer generation) — not a measured bill, since usage will vary by how active each tenant actually is.

| Item | Value |
|---|---|
| Assumed usage per tenant | 60 questions/day (~1,800/month) |
| Estimated cost per tenant / month | **$160** |
| Number of active tenants (current) | 3 |
| **Estimated total monthly budget** | **$480** |

## Sensitivity range

Actual cost per tenant depends on question complexity (simple lookups cost less, multi-step financial analysis costs more):

| Scenario | Cost per tenant / month | Total (3 tenants) |
|---|---|---|
| Lighter usage / simpler questions | ~$125 | ~$375 |
| Expected (mid-range) | **$160** | **$480** |
| Heavier usage / complex questions | ~$360 | ~$1,080 |

## Notes

- This is a **target budget ceiling** once tenants are in regular daily use — current actual spend is lower, since usage is still ramping up.
- Budget scales roughly linearly with each additional tenant onboarded, at this same per-tenant assumption.
- Document uploads (onboarding a tenant's knowledge base) add a smaller one-time cost on top of the monthly figure above, concentrated in the tenant's first month.
