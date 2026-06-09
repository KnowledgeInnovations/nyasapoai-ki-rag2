/**
 * seed-knowledge.mjs
 * Loads publicly available Knowledge Innovations knowledge into the RAG database.
 * Run once: node scripts/seed-knowledge.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Parse .env.local ─────────────────────────────────────────
const envContent = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
const env = {}
for (const line of envContent.split('\n')) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue
  const idx = line.indexOf('=')
  env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Knowledge documents ───────────────────────────────────────
const DOCUMENTS = [

  {
    title: 'Knowledge Innovations — Company Overview & History',
    department: 'general',
    sensitivity: 'public',
    content: `
KNOWLEDGE INNOVATIONS — COMPANY OVERVIEW

Company Name: Knowledge Innovations Ltd
Tagline: "Harnessing AI to spark innovation, boost decisions, and transform businesses."
Head Office: Tumu Avenue, Kanda, Accra, Ghana
Digital Address: GA-003-5259
Phone: +233 24 255 5135
Email: info@knowledgeinnovations.com
Website: www.knowledgeinnovations.com

ABOUT US
Knowledge Innovations is a leader in the provision of innovative services and products to help solve challenging problems. Our team of seasoned and passionate experts delivers cutting-edge professional services, specialising in advanced AI strategies, FinTech, Digital Financial Services, 4th Industrial Revolution tools, Digital Transformation, and Technology Innovations.

MISSION
To be a leader in the provision of innovative services and products that help organisations and individuals solve their most challenging problems through the smart application of technology.

CORE VALUE PROPOSITIONS
- Expert AI Solutions — deep, hands-on AI and emerging-technology expertise
- Solution Focused — every engagement is scoped around a measurable business outcome
- Customer Oriented — close collaboration with clients from diagnosis through delivery
- 99.99% Success — a delivery track record clients can rely on

INDUSTRIES SERVED
Knowledge Innovations works across retail, construction, media, manufacturing, FMCG, housing, banking, and the public sector — with a particular focus on African markets and the opportunities and constraints unique to the continent.

LEADERSHIP & CONSULTING TEAM
- Kwami Ahiabenu — Director & Tech Innovations Consultant
- Eugenia Blay — Digital Transformation & Innovation
- Eugene Agben — Technology & Corporate Leadership
- Dzifa Amenya — Consultant, Business Change and Project Management
- Eric Osiakwan — Consultant, Investments and Tech
- Gilbert Agyeman — Director of Finance
- Antoine G. Semaan — Consultant, Management and Audit
- Theodora Kwening — Social Media Associate

SOCIAL MEDIA
Facebook · X (Twitter): @kminnovations · LinkedIn · TikTok · YouTube
`,
  },

  {
    title: 'Knowledge Innovations — Services & Solutions Portfolio',
    department: 'general',
    sensitivity: 'public',
    content: `
KNOWLEDGE INNOVATIONS — SERVICES & SOLUTIONS PORTFOLIO

Knowledge Innovations organises its work into four core solution areas:

1. ARTIFICIAL INTELLIGENCE
- AI Strategy Consulting
- AI Integration and Automation
- Data Analytics and Insight Generation
- AI Training

2. FINTECH AND DIGITAL FINANCIAL SERVICES
- Fintech Innovations Integration
- Risk Management and Regulatory Compliance
- Digital Payments
- Cryptocurrency
- Training
- Cybersecurity
- Regulatory Technology (RegTech)

3. DIGITAL TRANSFORMATION
- Digital Transformation Consulting
- Knowledge Management
- Digitalisation Strategy Development
- Efficient Automation and Workflow Optimisation Services
- High-Level Training

4. TECHNOLOGY INNOVATIONS
- Software Development and Customisation
- Mobile Application Development
- AI & Machine Learning Solutions
- Enterprise Application Modernisation
- Cloud Consulting & Integration

ENGAGEMENT MODEL
Clients typically engage Knowledge Innovations through a "Talk to an Expert" consultation. From there, the team scopes a tailored engagement spanning one or more of the four solution areas above. Engagements range from short diagnostic assessments (e.g. an AI readiness audit) to multi-month transformation programmes with embedded consultants.

PRICING & PROPOSALS
Pricing is engagement-specific and depends on scope, duration, and the seniority of consultants required. Formal proposals are issued following the initial consultation and discovery phase.
`,
  },

  {
    title: 'AI Strategy & Consulting Practice — Engagement Playbook',
    department: 'contracts',
    sensitivity: 'public',
    content: `
AI STRATEGY & CONSULTING PRACTICE — ENGAGEMENT PLAYBOOK

PRACTICE AREA: Artificial Intelligence
LEAD CONSULTANT(S): Kwami Ahiabenu (Director & Tech Innovations Consultant), supported by the wider AI bench

SERVICES OFFERED
1. AI Strategy Consulting — helping leadership teams define where and how AI creates value, and building a roadmap to get there
2. AI Integration and Automation — embedding AI/ML into existing workflows, systems and customer journeys
3. Data Analytics and Insight Generation — turning raw organisational data into decision-ready insight
4. AI Training — building internal AI literacy and capability through structured training programmes

TYPICAL ENGAGEMENT FLOW
- Discovery workshop to map current data, tools, and decision processes
- AI readiness assessment — covering data governance, model monitoring, ownership of AI outputs, and team capability
- Roadmap and business case development
- Pilot implementation with measurable success criteria
- Scale-up support and embedded training for internal teams

DELIVERABLES CLIENTS RECEIVE
- AI readiness assessment reports
- AI strategy roadmaps and business cases
- Pilot project retrospectives and ROI analyses
- Training materials and capability-building plans

COMMON FINDINGS FROM AI READINESS ASSESSMENTS
- Data governance gaps — inconsistent data ownership, quality, and access controls
- Limited model monitoring — few clients have processes to track model drift or performance over time
- Unclear ownership of AI outputs — ambiguity over who is accountable for AI-assisted decisions
- Skills gaps — need for structured AI training across both technical and business teams

TARGET CLIENTS
Banks and financial institutions, manufacturers, retailers, media houses, public sector agencies, and any organisation in Ghana or the wider African market looking to move from "exploring AI" to running AI in production.
`,
  },

  {
    title: 'FinTech & Digital Financial Services Practice — Engagement Playbook',
    department: 'contracts',
    sensitivity: 'public',
    content: `
FINTECH & DIGITAL FINANCIAL SERVICES PRACTICE — ENGAGEMENT PLAYBOOK

PRACTICE AREA: FinTech and Digital Financial Services
LEAD CONSULTANT(S): Eric Osiakwan (Consultant, Investments and Tech), Gilbert Agyeman (Director of Finance)

SERVICES OFFERED
1. Fintech Innovations Integration — connecting banks, fintechs and merchants to new payment rails and digital financial products
2. Risk Management and Regulatory Compliance — building frameworks that satisfy regulators while enabling innovation
3. Digital Payments — design and rollout of mobile money, card, and digital wallet solutions
4. Cryptocurrency — advisory on digital asset strategy, custody, and regulatory positioning
5. Cybersecurity — securing financial systems and customer data against fraud and breach
6. Regulatory Technology (RegTech) — tooling that automates compliance monitoring and reporting
7. Training — building internal capability in digital financial services and compliance

TYPICAL ENGAGEMENT FLOW
- Regulatory and risk landscape review
- Gap analysis against current compliance posture
- Solution design (payments, RegTech, cybersecurity, or a combination)
- Pilot rollout with a defined client or merchant segment
- Compliance sign-off support and staff training

DELIVERABLES CLIENTS RECEIVE
- Compliance review reports and remediation plans
- Digital payments solution designs and vendor evaluations
- Cybersecurity audit reports with prioritised risk findings
- RegTech tooling recommendations and implementation roadmaps

TARGET CLIENTS
Commercial banks, microfinance institutions, mobile money operators, fintech startups, and any organisation handling digital financial transactions in Ghana and across Africa.
`,
  },

  {
    title: 'Digital Transformation & Technology Innovations Practice',
    department: 'contracts',
    sensitivity: 'public',
    content: `
DIGITAL TRANSFORMATION & TECHNOLOGY INNOVATIONS PRACTICE

PRACTICE AREAS: Digital Transformation, Technology Innovations
LEAD CONSULTANT(S): Eugenia Blay (Digital Transformation & Innovation), Eugene Agben (Technology & Corporate Leadership), Dzifa Amenya (Business Change & Project Management)

DIGITAL TRANSFORMATION SERVICES
- Digital Transformation Consulting
- Knowledge Management
- Digitalisation Strategy Development
- Efficient Automation and Workflow Optimisation Services
- High-Level Training

TECHNOLOGY INNOVATIONS SERVICES
- Software Development and Customisation
- Mobile Application Development
- AI & Machine Learning Solutions
- Enterprise Application Modernisation
- Cloud Consulting & Integration

TYPICAL ENGAGEMENT FLOW
- Current-state assessment of processes, systems, and organisational change readiness
- Digitalisation strategy and roadmap development
- Solution build (custom software, mobile apps, automation, cloud migration)
- Change management and workforce training
- Post-launch optimisation and support

DELIVERABLES CLIENTS RECEIVE
- Digital transformation roadmaps
- Process automation and workflow optimisation reports
- Custom software and mobile application builds
- Cloud migration and modernisation plans
- Change management and training programmes

TARGET CLIENTS
Manufacturers, FMCG companies, housing and construction firms, media houses, retailers, and public sector agencies seeking to modernise legacy systems and processes.
`,
  },

  {
    title: 'AI Innovation Cohorts & Training Programmes',
    department: 'general',
    sensitivity: 'public',
    content: `
AI INNOVATION COHORTS & TRAINING PROGRAMMES

OVERVIEW
Knowledge Innovations runs structured cohort-based training and innovation programmes that build AI, fintech, and digital transformation capability across Ghana and the wider region. The company has run multiple cohorts to date (Cohort 1 through Cohort 6, with a 7th cohort under way), each bringing together participants from different sectors for hands-on, expert-led learning.

PROGRAMME STRUCTURE
- Cohort-based learning — participants progress together through a structured curriculum
- Expert-led sessions — delivered by Knowledge Innovations consultants and guest practitioners
- Sector mix — cohorts typically include participants from banking, retail, manufacturing, media, housing and the public sector
- Practical focus — programmes emphasise applied projects over theory, often tied to real organisational challenges

TOPICS COVERED ACROSS COHORTS
- AI strategy and adoption fundamentals
- FinTech and digital financial services innovation
- Digital transformation and change management
- Cybersecurity and regulatory compliance basics
- Cloud, automation and emerging technology tools

EVENTS & COMMUNITY
Beyond cohorts, Knowledge Innovations runs events, publishes a blog, and maintains a directory connecting clients with vetted technology partners and practitioners across its network.

WHO SHOULD JOIN
Professionals and organisations across retail, construction, media, manufacturing, FMCG, housing, banking and the public sector who want to build internal AI and digital capability rather than rely solely on external consultants.
`,
  },

  {
    title: 'Knowledge Innovations — Client Engagement Process & FAQ',
    department: 'general',
    sensitivity: 'public',
    content: `
KNOWLEDGE INNOVATIONS — CLIENT ENGAGEMENT PROCESS & FAQ

HOW TO ENGAGE KNOWLEDGE INNOVATIONS

Step 1: Initial enquiry — reach out via the website's "Talk to an Expert" contact form, email, or phone
Step 2: Discovery consultation — a Knowledge Innovations consultant discusses your challenge, goals, and constraints
Step 3: Scoping & proposal — the team designs a tailored engagement across one or more of the four solution areas (AI, FinTech, Digital Transformation, Technology Innovations) and issues a formal proposal
Step 4: Kick-off & discovery workshops — deeper assessment of current systems, data, and processes
Step 5: Delivery — phased delivery of the agreed roadmap, pilots, builds, or training
Step 6: Review & handover — results review, knowledge transfer, and recommendations for next steps
Step 7: Ongoing support — many engagements continue into support, optimisation, or follow-on phases

CONTACT INFORMATION
Head Office: Tumu Avenue, Kanda, Accra, Ghana
Digital Address: GA-003-5259
Phone: +233 24 255 5135
Email: info@knowledgeinnovations.com
Website: www.knowledgeinnovations.com

Social Media:
- Facebook: Knowledge Innovations
- X (Twitter): @kminnovations
- LinkedIn: Knowledge Innovations
- TikTok: @knowledge.innovat
- YouTube: Knowledge Innovations

FREQUENTLY ASKED QUESTIONS

Q: What industries does Knowledge Innovations work with?
A: Retail, construction, media, manufacturing, FMCG, housing, banking, and the public sector — with a strong focus on African markets.

Q: Do you only work with large enterprises?
A: No. Engagements are scoped to the client's size and needs — from focused diagnostic assessments for smaller organisations to multi-phase transformation programmes for large enterprises and public institutions.

Q: Can you help us get started with AI if we have no prior experience?
A: Yes. The AI Strategy Consulting and AI Training services are specifically designed to take organisations from "exploring AI" to running AI in production, including building internal capability through training and cohorts.

Q: Do you provide ongoing support after a project is delivered?
A: Yes. Most engagements include a review and handover phase, and many clients continue into ongoing support, optimisation, or follow-on phases.

Q: How is pricing determined?
A: Pricing is engagement-specific, depending on scope, duration, and the consultants required. A formal proposal is issued after the discovery consultation.

Q: How can my team build internal AI and digital skills?
A: Through the AI Training, High-Level Training, and cohort-based innovation programmes (Cohorts 1–7 to date), which combine expert-led sessions with hands-on, applied projects.
`,
  },

  {
    title: 'Ghana Technology & AI Market Intelligence',
    department: 'board-reports',
    sensitivity: 'internal',
    content: `
GHANA TECHNOLOGY & AI MARKET INTELLIGENCE — BRIEFING

MARKET OVERVIEW
Ghana's technology and digital financial services sector is among the most dynamic in West Africa, driven by high mobile penetration, a fast-growing fintech ecosystem, an expanding pool of digitally fluent young professionals, and government-backed digitalisation initiatives across the public sector.

KEY TRENDS (2025/2026)
- Rapid growth in mobile money and digital payments adoption across both urban and rural markets
- Increasing regulatory focus from the Bank of Ghana on fintech licensing, data protection, and cybersecurity
- Growing enterprise appetite for AI pilots — particularly in banking, retail, and manufacturing — but limited in-house AI capability to scale them
- Expansion of cloud adoption and enterprise application modernisation, as legacy systems become a competitiveness bottleneck
- Rising demand for cybersecurity expertise as digital channels and digital financial services expand

DEMAND DRIVERS FOR CONSULTING & TRAINING SERVICES
1. Skills gap — far more organisations want to "do AI" than have staff who know how to scope, govern, and run AI responsibly
2. Regulatory complexity — fintech and digital financial services players need ongoing support to keep pace with evolving compliance requirements
3. Legacy modernisation pressure — manufacturers, FMCG players, and public sector bodies are under pressure to digitalise core processes
4. Diaspora and donor-funded digitalisation programmes — a steady pipeline of funded transformation initiatives across the public and development sectors
5. Regional expansion — African organisations increasingly look to Ghana-based consultancies with continental experience for cross-border digital strategy

COMPETITIVE LANDSCAPE
Knowledge Innovations operates in a market that includes global "big four"-style consultancies (higher price points, less local context), boutique African tech consultancies, and in-house digital teams within large enterprises and banks.

Knowledge Innovations' competitive advantages:
- A bench of senior consultants spanning AI, fintech, digital transformation, finance, and audit
- Deep local and regional context — particularly across African markets
- A track record across retail, construction, media, manufacturing, FMCG, housing, banking, and the public sector
- A unique combination of consulting delivery AND structured cohort-based training (building lasting client capability, not just one-off projects)
- A delivery track record summarised internally as "99.99% Success"

RISKS & MITIGANTS

Risk: Clients underestimate the change-management effort needed for AI/digital adoption
Mitigant: Engagements bundle technical delivery with training, knowledge management, and change-management consulting

Risk: Regulatory shifts in fintech and data protection
Mitigant: Dedicated Risk Management & Regulatory Compliance and RegTech service lines tracking regulatory developments closely

Risk: Talent scarcity in AI and cybersecurity specialisms
Mitigant: Cohort-based training programmes build a pipeline of trained talent for clients and the wider ecosystem

OUTLOOK (2026–2028)
Demand for AI strategy, fintech compliance, and digital transformation services is expected to keep growing as Ghanaian and regional organisations move from experimentation to production deployment, and as regulators raise the bar on compliance and cybersecurity.
`,
  },

]

// ── Helpers ───────────────────────────────────────────────────
function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize))
    start += chunkSize - overlap
  }
  return chunks.filter(c => c.trim().length > 60)
}

async function embedText(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  })
  const data = await res.json()
  if (!data.data?.[0]?.embedding) throw new Error('Embedding failed: ' + JSON.stringify(data))
  return data.data[0].embedding
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🌍  Seeding Knowledge Innovations knowledge base...\n')

  // Get tenant
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('subdomain', 'knowledgeinnovations').maybeSingle()
  if (!tenant) throw new Error('Knowledge Innovations tenant not found. Run seed.mjs first.')
  const tenantId = tenant.id

  // Get admin user
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const admin = users?.find(u => u.email === 'admin@knowledgeinnovations.com')
  if (!admin) throw new Error('Admin user not found. Run seed.mjs first.')
  const adminId = admin.id

  let totalChunks = 0

  for (const doc of DOCUMENTS) {
    console.log(`📄  Processing: ${doc.title}`)

    // Check if document already exists
    const { data: existing } = await supabase
      .from('documents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('title', doc.title)
      .maybeSingle()

    if (existing) {
      console.log(`    ↳ Already exists, skipping.\n`)
      continue
    }

    // Insert document record
    const { data: document, error: docErr } = await supabase
      .from('documents')
      .insert({
        tenant_id:   tenantId,
        uploaded_by: adminId,
        title:       doc.title,
        source:      'knowledgeinnovations.com (public knowledge)',
        department:  doc.department,
        sensitivity: doc.sensitivity,
        status:      'processing',
      })
      .select()
      .single()

    if (docErr || !document) {
      console.error(`    ✗ Failed to create document record:`, docErr?.message)
      continue
    }

    // Chunk and embed
    const text   = doc.content.trim()
    const chunks = chunkText(text)
    console.log(`    ↳ ${chunks.length} chunks to embed…`)

    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embedText(chunks[i])
        await supabase.from('document_chunks').insert({
          document_id: document.id,
          tenant_id:   tenantId,
          chunk_text:  chunks[i],
          chunk_index: i,
          embedding,
          metadata: { source: 'knowledgeinnovations.com', chunk_index: i, total_chunks: chunks.length },
        })
        process.stdout.write('.')
        totalChunks++
      } catch (e) {
        console.error(`\n    ✗ Chunk ${i} failed:`, e.message)
      }
    }

    // Mark ready
    await supabase.from('documents').update({ status: 'ready' }).eq('id', document.id)
    console.log(`\n    ✓ Done — ${chunks.length} chunks stored.\n`)
  }

  console.log(`\n✅  Knowledge base seeded successfully!`)
  console.log(`   ${DOCUMENTS.length} documents · ${totalChunks} chunks total`)
  console.log(`\n   The AI can now answer questions about:`)
  console.log(`   • Knowledge Innovations company history, mission, and leadership`)
  console.log(`   • Services across AI, FinTech, Digital Transformation, and Technology Innovations`)
  console.log(`   • AI Strategy, FinTech, and Digital Transformation engagement playbooks`)
  console.log(`   • AI innovation cohorts and training programmes`)
  console.log(`   • Ghana technology & AI market intelligence`)
  console.log(`   • Client engagement process, FAQs, and contact information`)
  console.log(`\n   Login at http://localhost:3000/auth/login and start asking!\n`)
}

main().catch(err => {
  console.error('\n✗ Error:', err.message)
  process.exit(1)
})
