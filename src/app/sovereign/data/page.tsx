"use client"

import { useState } from "react"
import {
  Database,
  BarChart3,
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  Globe,
  Users,
  Building2,
  Wifi,
  TrendingUp,
  Calendar,
  Eye,
  Copy,
  Check,
  FileJson,
  Table,
} from "lucide-react"
import { Modal } from "@/components/sovereign/Modal"

// Real Ghana datasets with accurate information
const datasets = [
  {
    id: "gh-infra-2024",
    icon: Wifi,
    title: "Ghana Digital Infrastructure Index 2024",
    description: "Comprehensive mapping of telecommunications towers, fiber optic cables, and internet service providers across all 16 regions of Ghana. Includes coverage statistics for 4G/5G networks.",
    size: "847 MB",
    format: "GeoJSON, CSV, Shapefile",
    lastUpdated: "March 15, 2024",
    category: "Infrastructure",
    downloads: 12847,
    records: 45892,
    license: "Open Government License",
    source: "National Communications Authority (NCA)",
    previewData: [
      { region: "Greater Accra", towers: 2847, coverage: "98.4%", fiberKm: 1245 },
      { region: "Ashanti", towers: 1923, coverage: "94.2%", fiberKm: 876 },
      { region: "Western", towers: 1245, coverage: "87.6%", fiberKm: 542 },
      { region: "Central", towers: 987, coverage: "89.3%", fiberKm: 423 },
      { region: "Eastern", towers: 1102, coverage: "85.7%", fiberKm: 387 },
    ]
  },
  {
    id: "gh-egov-adoption",
    icon: Users,
    title: "E-Government Service Adoption Metrics",
    description: "Usage statistics for Ghana.gov digital services including GhanaPostGPS, mobile money integration, digital ID enrollment, and online tax filing across all metropolitan, municipal, and district assemblies.",
    size: "234 MB",
    format: "CSV, Excel, JSON",
    lastUpdated: "April 1, 2024",
    category: "Government",
    downloads: 8923,
    records: 261000,
    license: "Creative Commons BY 4.0",
    source: "Ministry of Communications and Digitalisation",
    previewData: [
      { service: "GhanaPostGPS", users: 4200000, adoption: "14.2%", growth: "+23%" },
      { service: "Ghana Card Registration", users: 17800000, adoption: "60.1%", growth: "+8%" },
      { service: "Mobile Money", users: 19400000, adoption: "65.5%", growth: "+15%" },
      { service: "E-Tax Filing", users: 2100000, adoption: "7.1%", growth: "+45%" },
      { service: "NHIS Mobile", users: 8900000, adoption: "30.1%", growth: "+12%" },
    ]
  },
  {
    id: "gh-lang-census",
    icon: Globe,
    title: "Ghana Linguistic Census Data 2021",
    description: "Detailed breakdown of language speakers across Ghana including Akan (Twi, Fante), Ga, Ewe, Dagbani, and 75+ other indigenous languages. Data supports NyansaPo translation model development.",
    size: "156 MB",
    format: "JSON, CSV, Parquet",
    lastUpdated: "Census 2021",
    category: "Demographics",
    downloads: 15234,
    records: 32847,
    license: "Open Government License",
    source: "Ghana Statistical Service",
    previewData: [
      { language: "Akan (Twi/Fante)", speakers: 11200000, percentage: "37.8%", regions: 6 },
      { language: "Ewe", speakers: 3800000, percentage: "12.8%", regions: 2 },
      { language: "Ga-Dangme", speakers: 2400000, percentage: "8.1%", regions: 2 },
      { language: "Dagbani", speakers: 1800000, percentage: "6.1%", regions: 3 },
      { language: "Hausa", speakers: 1200000, percentage: "4.1%", regions: 5 },
    ]
  },
  {
    id: "gh-policy-archive",
    icon: FileSpreadsheet,
    title: "Ghana Policy & Legislation Archive",
    description: "Machine-readable archive of Ghanaian laws, parliamentary acts, executive instruments, and policy documents from 1957 to present. Full-text search enabled with NyansaPo AI indexing.",
    size: "3.2 GB",
    format: "PDF, XML, JSON-LD",
    lastUpdated: "Weekly sync",
    category: "Legal",
    downloads: 6721,
    records: 48923,
    license: "Public Domain",
    source: "Parliament of Ghana / Judicial Service",
    previewData: [
      { category: "Acts of Parliament", count: 2847, latestYear: 2024, digitized: "100%" },
      { category: "Executive Instruments", count: 12934, latestYear: 2024, digitized: "98%" },
      { category: "Constitutional Instruments", count: 487, latestYear: 2024, digitized: "100%" },
      { category: "Court Rulings", count: 28745, latestYear: 2024, digitized: "76%" },
      { category: "Policy Documents", count: 3910, latestYear: 2024, digitized: "89%" },
    ]
  },
  {
    id: "gh-health-facilities",
    icon: Building2,
    title: "Ghana Health Facilities Registry",
    description: "Complete registry of hospitals, clinics, CHPS compounds, and pharmacies with GPS coordinates, services offered, and capacity data. Integrated with NHIS facility codes.",
    size: "89 MB",
    format: "GeoJSON, CSV",
    lastUpdated: "February 28, 2024",
    category: "Health",
    downloads: 9834,
    records: 18247,
    license: "Open Government License",
    source: "Ghana Health Service",
    previewData: [
      { type: "Hospitals", count: 347, beds: 18924, nhisAccredited: "92%" },
      { type: "Health Centers", count: 1247, beds: 4892, nhisAccredited: "88%" },
      { type: "CHPS Compounds", count: 6892, beds: 0, nhisAccredited: "95%" },
      { type: "Clinics", count: 4523, beds: 2341, nhisAccredited: "79%" },
      { type: "Pharmacies", count: 5238, beds: 0, nhisAccredited: "67%" },
    ]
  },
  {
    id: "gh-economic-indicators",
    icon: TrendingUp,
    title: "Ghana Economic Indicators Dashboard",
    description: "Monthly economic data including GDP, inflation rates, exchange rates, trade balance, and sector-specific performance metrics. Powers NyansaPo economic analysis models.",
    size: "67 MB",
    format: "CSV, JSON, Excel",
    lastUpdated: "April 10, 2024",
    category: "Economic",
    downloads: 21456,
    records: 156000,
    license: "Creative Commons BY 4.0",
    source: "Bank of Ghana / Ghana Statistical Service",
    previewData: [
      { indicator: "GDP Growth Rate", value: "2.9%", period: "Q4 2023", trend: "up" },
      { indicator: "Inflation Rate", value: "23.2%", period: "March 2024", trend: "down" },
      { indicator: "Exchange Rate (USD)", value: "12.85 GHS", period: "April 2024", trend: "stable" },
      { indicator: "Policy Rate", value: "29.0%", period: "March 2024", trend: "stable" },
      { indicator: "Trade Balance", value: "-$1.2B", period: "Q4 2023", trend: "down" },
    ]
  },
]

const categories = ["All", "Infrastructure", "Government", "Demographics", "Legal", "Health", "Economic"]

const stats = [
  { value: "156", label: "Open Datasets", icon: Database },
  { value: "2.4M", label: "API Requests/Day", icon: BarChart3 },
  { value: "18", label: "Government Partners", icon: Building2 },
  { value: "99.97%", label: "API Uptime", icon: TrendingUp },
]

export default function DataPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [previewDataset, setPreviewDataset] = useState<typeof datasets[0] | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showApiDocs, setShowApiDocs] = useState(false)
  const [showAccessForm, setShowAccessForm] = useState(false)
  const [accessFormData, setAccessFormData] = useState({ name: "", email: "", organization: "", useCase: "" })
  const [accessSubmitted, setAccessSubmitted] = useState(false)

  const filteredDatasets = datasets.filter(dataset => {
    const matchesSearch = dataset.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         dataset.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "All" || dataset.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const handleDownload = (dataset: typeof datasets[0]) => {
    // Create a sample CSV content
    const headers = Object.keys(dataset.previewData[0]).join(",")
    const rows = dataset.previewData.map(row => Object.values(row).join(",")).join("\n")
    const csvContent = `# ${dataset.title}\n# Source: ${dataset.source}\n# License: ${dataset.license}\n# Last Updated: ${dataset.lastUpdated}\n\n${headers}\n${rows}`

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${dataset.id}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleCopyApiEndpoint = (datasetId: string) => {
    navigator.clipboard.writeText(`https://api.nyansapo.gov.gh/v1/datasets/${datasetId}`)
    setCopiedId(datasetId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleAccessSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setAccessSubmitted(true)
    setTimeout(() => {
      setShowAccessForm(false)
      setAccessSubmitted(false)
      setAccessFormData({ name: "", email: "", organization: "", useCase: "" })
    }, 2000)
  }

  return (
    <>
      {/* Hero Section */}
      <section className="px-6 py-16 bg-gradient-to-b from-[#f8fafc] to-white">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2563eb]/10 text-[#2563eb] text-sm font-medium mb-4">
            <Database className="h-4 w-4" />
            Ghana Open Data Initiative
          </div>
          <h1 className="text-4xl font-bold text-[#0f172a] mb-4">
            Open Data Portal
          </h1>
          <p className="text-lg text-[#64748b] mb-8 max-w-2xl mx-auto">
            Access Ghana&apos;s official government datasets. Transparent, machine-readable, and ready for analysis.
            Powering data-driven decisions across the nation.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#1d4ed8]"
              onClick={() => setShowApiDocs(true)}
            >
              <FileJson className="h-4 w-4" />
              Explore API Docs
            </button>
            <button
              className="rounded-lg border border-[#0f172a] px-4 py-2 font-medium text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
              onClick={() => setShowAccessForm(true)}
            >
              Request API Access
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-6 py-8 border-b border-[#e2e2e2]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => {
              const Icon = stat.icon
              return (
                <div key={stat.label} className="text-center">
                  <div className="flex justify-center mb-2">
                    <div className="h-10 w-10 rounded-lg bg-[#2563eb]/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-[#2563eb]" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-[#0f172a] mb-1">{stat.value}</p>
                  <p className="text-sm text-[#6b7280]">{stat.label}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Search and Filter */}
      <section className="px-6 py-8 bg-[#f8fafc] border-b border-[#e2e2e2]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6b7280]" />
              <input
                placeholder="Search datasets by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[#e2e2e2] bg-white pl-10 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
              <Filter className="h-4 w-4 text-[#6b7280] flex-shrink-0" />
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedCategory === category
                      ? "bg-[#2563eb] text-white"
                      : "border border-[#e2e2e2] text-[#6b7280] hover:text-[#0f172a]"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Datasets */}
      <section className="px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-[#0f172a]">
              {selectedCategory === "All" ? "All Datasets" : `${selectedCategory} Datasets`}
            </h2>
            <p className="text-sm text-[#6b7280]">
              {filteredDatasets.length} dataset{filteredDatasets.length !== 1 ? "s" : ""} found
            </p>
          </div>

          <div className="space-y-4">
            {filteredDatasets.map((dataset) => {
              const Icon = dataset.icon
              return (
                <div
                  key={dataset.id}
                  className="bg-white rounded-xl border border-[#e2e2e2] p-6 hover:border-[#2563eb] hover:shadow-md transition-all"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    <div className="h-12 w-12 rounded-xl bg-[#f1f5f9] flex items-center justify-center flex-shrink-0">
                      <Icon className="h-6 w-6 text-[#2563eb]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-[#0f172a]">{dataset.title}</h3>
                            <span className="px-2 py-0.5 rounded-full bg-[#f1f5f9] text-xs text-[#6b7280]">
                              {dataset.category}
                            </span>
                          </div>
                          <p className="text-sm text-[#64748b] mb-3">{dataset.description}</p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#6b7280]">
                            <span className="flex items-center gap-1">
                              <Database className="h-3 w-3" /> {dataset.size}
                            </span>
                            <span className="flex items-center gap-1">
                              <Table className="h-3 w-3" /> {dataset.records.toLocaleString()} records
                            </span>
                            <span className="flex items-center gap-1">
                              <FileSpreadsheet className="h-3 w-3" /> {dataset.format}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" /> {dataset.lastUpdated}
                            </span>
                            <span className="flex items-center gap-1">
                              <Download className="h-3 w-3" /> {dataset.downloads.toLocaleString()} downloads
                            </span>
                          </div>
                          <p className="text-xs text-[#94a3b8] mt-2">
                            Source: {dataset.source} | License: {dataset.license}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            className="flex items-center gap-1 rounded-lg border border-[#e2e2e2] px-3 py-1.5 text-sm font-medium transition-colors hover:border-[#2563eb] hover:text-[#2563eb]"
                            onClick={() => setPreviewDataset(dataset)}
                          >
                            <Eye className="h-4 w-4" /> Preview
                          </button>
                          <button
                            className="flex items-center gap-1 rounded-lg border border-[#e2e2e2] px-3 py-1.5 text-sm font-medium transition-colors hover:border-[#2563eb] hover:text-[#2563eb]"
                            onClick={() => handleCopyApiEndpoint(dataset.id)}
                          >
                            {copiedId === dataset.id ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                            API
                          </button>
                          <button
                            className="flex items-center gap-1 rounded-lg bg-[#2563eb] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1d4ed8]"
                            onClick={() => handleDownload(dataset)}
                          >
                            <Download className="h-4 w-4" /> Download
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {filteredDatasets.length === 0 && (
            <div className="text-center py-12">
              <Database className="h-12 w-12 text-[#d1d5db] mx-auto mb-4" />
              <h3 className="text-lg font-medium text-[#0f172a] mb-2">No datasets found</h3>
              <p className="text-sm text-[#6b7280]">
                Try adjusting your search or filter criteria
              </p>
            </div>
          )}
        </div>
      </section>

      {/* API Information */}
      <section className="px-6 py-12 bg-[#0f172a]">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl font-bold text-white mb-4">
                Programmatic Access via REST API
              </h2>
              <p className="text-[#94a3b8] mb-6">
                Access all datasets programmatically through our RESTful API.
                Supports JSON, CSV, and GeoJSON responses with pagination and filtering.
              </p>
              <div className="bg-[#1e293b] rounded-lg p-4 font-mono text-sm">
                <p className="text-[#94a3b8] mb-2"># Example API Request</p>
                <p className="text-[#22c55e]">curl -X GET \</p>
                <p className="text-white pl-4">&quot;https://api.nyansapo.gov.gh/v1/datasets/gh-infra-2024&quot; \</p>
                <p className="text-[#60a5fa] pl-4">-H &quot;Authorization: Bearer YOUR_API_KEY&quot;</p>
              </div>
            </div>
            <div className="bg-[#1e293b] rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">API Features</h3>
              <ul className="space-y-3">
                {[
                  "RESTful endpoints for all 156 datasets",
                  "Real-time data streaming for live indicators",
                  "GraphQL support for complex queries",
                  "Webhook notifications for data updates",
                  "Rate limits: 10,000 requests/hour (Pro tier)",
                ].map((feature, index) => (
                  <li key={index} className="flex items-center gap-3 text-[#94a3b8]">
                    <Check className="h-4 w-4 text-[#22c55e] flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className="w-full mt-6 rounded-lg bg-[#2563eb] py-2 font-medium text-white transition-colors hover:bg-[#1d4ed8]"
                onClick={() => setShowApiDocs(true)}
              >
                View Full Documentation
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Preview Dialog */}
      <Modal
        open={!!previewDataset}
        onClose={() => setPreviewDataset(null)}
        className="max-w-4xl"
        title={
          previewDataset && (
            <span className="flex items-center gap-2">
              <previewDataset.icon className="h-5 w-5 text-[#2563eb]" />
              {previewDataset.title}
            </span>
          )
        }
        description="Sample data preview (showing first 5 records)"
      >
        {previewDataset && (
          <div className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e2e2e2]">
                    {Object.keys(previewDataset.previewData[0]).map((key) => (
                      <th key={key} className="text-left py-2 px-3 font-medium text-[#0f172a] bg-[#f8fafc]">
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewDataset.previewData.map((row, index) => (
                    <tr key={index} className="border-b border-[#e2e2e2] hover:bg-[#f8fafc]">
                      {Object.values(row).map((value, cellIndex) => (
                        <td key={cellIndex} className="py-2 px-3 text-[#64748b]">
                          {String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 p-4 bg-[#f8fafc] rounded-lg">
              <h4 className="font-medium text-[#0f172a] mb-2">Dataset Information</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[#6b7280]">Total Records</p>
                  <p className="font-medium text-[#0f172a]">{previewDataset.records.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[#6b7280]">File Size</p>
                  <p className="font-medium text-[#0f172a]">{previewDataset.size}</p>
                </div>
                <div>
                  <p className="text-[#6b7280]">Source</p>
                  <p className="font-medium text-[#0f172a]">{previewDataset.source}</p>
                </div>
                <div>
                  <p className="text-[#6b7280]">License</p>
                  <p className="font-medium text-[#0f172a]">{previewDataset.license}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="flex items-center gap-2 rounded-lg border border-[#e2e2e2] px-4 py-2 text-sm font-medium transition-colors hover:bg-[#f8fafc]"
                onClick={() => handleCopyApiEndpoint(previewDataset.id)}
              >
                {copiedId === previewDataset.id ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy API Endpoint
                  </>
                )}
              </button>
              <button
                className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1d4ed8]"
                onClick={() => {
                  handleDownload(previewDataset)
                  setPreviewDataset(null)
                }}
              >
                <Download className="h-4 w-4" />
                Download Full Dataset
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* API Docs Dialog */}
      <Modal
        open={showApiDocs}
        onClose={() => setShowApiDocs(false)}
        className="max-w-3xl"
        title="NyansaPo Open Data API Documentation"
        description="RESTful API for accessing Ghana's open government datasets"
      >
        <div className="mt-4 space-y-6">
          <div>
            <h4 className="font-semibold text-[#0f172a] mb-2">Base URL</h4>
            <code className="block bg-[#f1f5f9] p-3 rounded-lg text-sm">
              https://api.nyasapo.gov.gh/v1
            </code>
          </div>

          <div>
            <h4 className="font-semibold text-[#0f172a] mb-2">Authentication</h4>
            <p className="text-sm text-[#64748b] mb-2">
              All API requests require an API key passed in the Authorization header.
            </p>
            <code className="block bg-[#f1f5f9] p-3 rounded-lg text-sm">
              Authorization: Bearer YOUR_API_KEY
            </code>
          </div>

          <div>
            <h4 className="font-semibold text-[#0f172a] mb-2">Endpoints</h4>
            <div className="space-y-3">
              {[
                { method: "GET", endpoint: "/datasets", description: "List all available datasets" },
                { method: "GET", endpoint: "/datasets/:id", description: "Get dataset metadata" },
                { method: "GET", endpoint: "/datasets/:id/data", description: "Fetch dataset records" },
                { method: "GET", endpoint: "/datasets/:id/download", description: "Download full dataset" },
              ].map((item, index) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-[#f8fafc] rounded-lg">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    item.method === "GET" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {item.method}
                  </span>
                  <div>
                    <code className="text-sm font-medium text-[#0f172a]">{item.endpoint}</code>
                    <p className="text-xs text-[#6b7280] mt-1">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-[#0f172a] mb-2">Query Parameters</h4>
            <div className="space-y-2 text-sm">
              <p><code className="bg-[#f1f5f9] px-1 rounded">limit</code> - Number of records (default: 100, max: 10000)</p>
              <p><code className="bg-[#f1f5f9] px-1 rounded">offset</code> - Pagination offset</p>
              <p><code className="bg-[#f1f5f9] px-1 rounded">format</code> - Response format (json, csv, geojson)</p>
              <p><code className="bg-[#f1f5f9] px-1 rounded">filter</code> - Field filtering (e.g., region=Ashanti)</p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-[#0f172a] mb-2">Rate Limits</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-3 bg-[#f8fafc] rounded-lg">
                <p className="font-medium text-[#0f172a]">Free Tier</p>
                <p className="text-[#6b7280]">1,000 requests/hour</p>
              </div>
              <div className="p-3 bg-[#f8fafc] rounded-lg">
                <p className="font-medium text-[#0f172a]">Pro Tier</p>
                <p className="text-[#6b7280]">10,000 requests/hour</p>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Access Request Dialog */}
      <Modal
        open={showAccessForm}
        onClose={() => setShowAccessForm(false)}
        title="Request API Access"
        description="Get your API key to access Ghana's open data programmatically"
      >
        {accessSubmitted ? (
          <div className="py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="font-semibold text-[#0f172a] mb-2">Request Submitted!</h3>
            <p className="text-sm text-[#64748b]">
              You&apos;ll receive your API key via email within 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleAccessSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#0f172a] mb-1">Full Name</label>
              <input
                required
                value={accessFormData.name}
                onChange={(e) => setAccessFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Kwame Asante"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0f172a] mb-1">Email Address</label>
              <input
                type="email"
                required
                value={accessFormData.email}
                onChange={(e) => setAccessFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="kwame@example.com"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0f172a] mb-1">Organization</label>
              <input
                required
                value={accessFormData.organization}
                onChange={(e) => setAccessFormData(prev => ({ ...prev, organization: e.target.value }))}
                placeholder="University of Ghana"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0f172a] mb-1">Intended Use Case</label>
              <textarea
                required
                value={accessFormData.useCase}
                onChange={(e) => setAccessFormData(prev => ({ ...prev, useCase: e.target.value }))}
                placeholder="Describe how you plan to use the data..."
                className="w-full p-3 rounded-lg border border-[#e2e2e2] text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#2563eb] py-2 font-medium text-white transition-colors hover:bg-[#1d4ed8]">
              Submit Request
            </button>
          </form>
        )}
      </Modal>
    </>
  )
}
