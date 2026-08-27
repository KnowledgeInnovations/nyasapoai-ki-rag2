"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Sparkles,
  Languages,
  Wand2,
  Undo2,
  Redo2,
  MoreVertical,
  FileText,
  Shield,
  CheckCircle,
  Plus,
  Copy,
  Download,
  Trash2
} from "lucide-react"
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/sovereign/Dropdown"
import { cn } from "@/lib/utils"

const recentDocuments = [
  {
    id: 1,
    title: "Q4 Infrastructure Report",
    modified: "Modified 2h ago",
    status: "Draft",
    icon: FileText,
  },
  {
    id: 2,
    title: "Cybersecurity Protocol v2",
    modified: "Modified 5h ago",
    status: "Complete",
    icon: Shield,
  },
  {
    id: 3,
    title: "Privacy Policy Update",
    modified: "Modified Yesterday",
    status: "Draft",
    icon: CheckCircle,
  },
]

const initialContent = `I. PURPOSE: The purpose of this memorandum is to seek approval for the immediate deployment of mobile broadband towers in under-served districts as part of the Phase 2 Digital Expansion project.

II. BACKGROUND: Current data indicates that 34% of rural households lack reliable internet access. This deficit hampers the delivery of e-health, e-education, and digital financial services which are critical to our national development goals.

III. ANALYSIS: Initial projections from the KiYaNi AI Engine suggest that a decentralized mesh-network approach will reduce infrastructure costs by 22% while increasing coverage stability during peak hours by 40%.`

export default function DashboardPage() {
  const router = useRouter()
  const [activeAction, setActiveAction] = useState<string>("summarize")
  const [documentContent, setDocumentContent] = useState(initialContent)
  const [history, setHistory] = useState<string[]>([initialContent])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState({
    visible: true,
    title: "AI SUGGESTION - REFINED HEADER",
    content: `This memorandum outlines the strategic implementation of the "Digital Ghana" initiative, focusing on closing the urban-rural divide through AI-optimized network distribution models.`
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const actions = [
    { id: "summarize", label: "Summarize", icon: Sparkles },
    { id: "translate", label: "Translate", icon: Languages },
    { id: "refine", label: "Refine", icon: Wand2 },
  ]

  const addToHistory = (newContent: string) => {
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(newContent)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1)
      setDocumentContent(history[historyIndex - 1])
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1)
      setDocumentContent(history[historyIndex + 1])
    }
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setDocumentContent(newContent)
    addToHistory(newContent)
  }

  const handleAction = async (actionId: string) => {
    setActiveAction(actionId)
    setIsProcessing(true)

    // Simulate AI processing
    setTimeout(() => {
      if (actionId === "summarize") {
        setAiSuggestion({
          visible: true,
          title: "AI SUGGESTION - SUMMARY",
          content: "This memorandum requests approval for mobile broadband deployment in rural areas. Key findings: 34% of rural households lack internet access, and a decentralized mesh-network could reduce costs by 22% while improving coverage stability by 40%."
        })
      } else if (actionId === "translate") {
        setAiSuggestion({
          visible: true,
          title: "AI SUGGESTION - TRANSLATION READY",
          content: "Document is ready for translation to Twi (Asante). The AI has identified 12 technical terms that will require contextual adaptation for maximum clarity in the target language."
        })
        // Navigate to translation page
        setTimeout(() => router.push("/sovereign/ai-models"), 500)
      } else if (actionId === "refine") {
        setAiSuggestion({
          visible: true,
          title: "AI SUGGESTION - REFINED VERSION",
          content: "Suggested refinements: (1) Add executive summary at the beginning, (2) Include specific cost projections in Section III, (3) Add a recommendation section with clear action items for approval."
        })
      }
      setIsProcessing(false)
    }, 1000)
  }

  const handleCopyDocument = () => {
    navigator.clipboard.writeText(documentContent)
  }

  const handleDownloadDocument = () => {
    const blob = new Blob([documentContent], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "policy-memorandum.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClearDocument = () => {
    setDocumentContent("")
    addToHistory("")
  }

  const handleAutoFill = () => {
    setIsProcessing(true)
    setTimeout(() => {
      const additionalContent = `

IV. RECOMMENDATIONS:
Based on the analysis above, we recommend the following:

A. Immediate approval of Phase 2 Digital Expansion budget allocation of GH₵ 45.2 million.

B. Prioritize deployment in the following regions: Northern, Upper East, and Upper West.

C. Establish public-private partnerships with local telecommunications providers.

D. Implement community-based digital literacy programs alongside infrastructure rollout.

V. CONCLUSION:
This initiative aligns with our national development goals and will significantly impact rural communities. We respectfully request expedited review and approval.`

      const newContent = documentContent + additionalContent
      setDocumentContent(newContent)
      addToHistory(newContent)
      setIsProcessing(false)
    }, 1500)
  }

  const handleContinueWriting = () => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      )
    }
  }

  const wordCount = documentContent.trim() ? documentContent.trim().split(/\s+/).length : 0

  return (
    <div className="flex-1 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-2">
          <span className="text-[#6b7280]">EDITOR</span>
          <span className="text-[#6b7280]">&gt;</span>
          <span className="text-[#2563eb] font-medium">NYANSAPO AI WORKSPACE</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-[#0f172a] mb-2">Drafting Policy Memorandum</h1>
        <p className="text-[#64748b] mb-6">
          Use <span className="font-semibold text-[#0f172a]">NyansaPo</span>&apos;s smart tools to accelerate your legislative and executive drafting. AI-assisted
          refinement with secure, local governance controls.
        </p>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Editor Area */}
          <div className="lg:col-span-2">
            {/* Action Buttons */}
            <div className="flex items-center gap-3 mb-6">
              {actions.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                      activeAction === action.id
                        ? "bg-[#2563eb] hover:bg-[#004fcb] text-white"
                        : "border border-[#e2e2e2] text-[#424656] hover:bg-[#f8fafc]"
                    )}
                    onClick={() => handleAction(action.id)}
                    disabled={isProcessing}
                  >
                    <Icon className="h-4 w-4" />
                    {isProcessing && activeAction === action.id ? "Processing..." : action.label}
                  </button>
                )
              })}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f8fafc] disabled:pointer-events-none disabled:opacity-50"
                  onClick={handleUndo}
                  disabled={historyIndex === 0}
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f8fafc] disabled:pointer-events-none disabled:opacity-50"
                  onClick={handleRedo}
                  disabled={historyIndex === history.length - 1}
                >
                  <Redo2 className="h-4 w-4" />
                </button>
                <Dropdown
                  trigger={
                    <button className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f8fafc]">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  }
                >
                  <DropdownItem onClick={handleCopyDocument}>
                    <Copy className="h-4 w-4 mr-2" /> Copy to Clipboard
                  </DropdownItem>
                  <DropdownItem onClick={handleDownloadDocument}>
                    <Download className="h-4 w-4 mr-2" /> Download
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem onClick={handleClearDocument} className="text-red-600">
                    <Trash2 className="h-4 w-4 mr-2" /> Clear Document
                  </DropdownItem>
                </Dropdown>
              </div>
            </div>

            {/* Document Editor */}
            <div className="bg-white rounded-xl border border-[#e2e2e2] p-8">
              {/* Document Title */}
              <div className="text-center mb-8">
                <h2 className="font-semibold text-[#0f172a] text-sm uppercase tracking-wide">
                  MEMORANDUM FOR THE HEAD OF STATE
                </h2>
                <p className="text-xs text-[#6b7280] mt-1">
                  SUBJECT: ACCELERATING DIGITAL INFRASTRUCTURE IN RURAL REGIONS
                </p>
              </div>

              {/* AI Suggestion Box */}
              {aiSuggestion.visible && (
                <div className="bg-[#f1f5f9] border-l-4 border-[#2563eb] rounded-r-lg p-4 mb-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-[#2563eb] font-semibold uppercase mb-2">
                        {aiSuggestion.title}
                      </p>
                      <p className="text-[#424656] leading-relaxed">
                        {aiSuggestion.content}
                      </p>
                    </div>
                    <button
                      onClick={() => setAiSuggestion({ ...aiSuggestion, visible: false })}
                      className="text-[#6b7280] hover:text-[#0f172a] -mt-1 -mr-2 text-sm font-medium px-2 py-1 rounded transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Document Content */}
              <div className="prose prose-sm max-w-none">
                <textarea
                  ref={textareaRef}
                  value={documentContent}
                  onChange={handleContentChange}
                  className="w-full min-h-[300px] text-[#424656] leading-relaxed resize-none border-none focus:outline-none focus:ring-0 bg-transparent"
                />
              </div>

              {/* Continue Writing */}
              <button
                onClick={handleContinueWriting}
                className="mt-8 w-full border-2 border-dashed border-[#e2e2e2] rounded-xl p-8 text-center hover:border-[#2563eb] hover:bg-[#f8fafc] transition-colors"
              >
                <Plus className="h-6 w-6 text-[#6b7280] mx-auto mb-2" />
                <p className="text-sm text-[#6b7280]">
                  Continue writing or press &apos;/&apos; for AI prompts
                </p>
              </button>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Document Health */}
            <div className="bg-white rounded-xl border border-[#e2e2e2] p-6">
              <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide mb-4">
                Document Health
              </h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[#424656]">AI Confidence Score</span>
                <span className="text-2xl font-bold text-[#2563eb]">94%</span>
              </div>
              <div className="h-2 bg-[#e2e2e2] rounded-full mb-6">
                <div className="h-2 bg-[#2563eb] rounded-full" style={{ width: "94%" }}></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#f8fafc] rounded-lg p-4 text-center">
                  <p className="text-xs text-[#6b7280] uppercase mb-1">Word Count</p>
                  <p className="text-xl font-bold text-[#0f172a]">{wordCount.toLocaleString()}</p>
                </div>
                <div className="bg-[#f8fafc] rounded-lg p-4 text-center">
                  <p className="text-xs text-[#6b7280] uppercase mb-1">Readability</p>
                  <p className="text-xl font-bold text-[#0f172a]">Expert</p>
                </div>
              </div>
            </div>

            {/* Recent Documents */}
            <div className="bg-white rounded-xl border border-[#e2e2e2] p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide">
                  Recent Documents
                </h3>
                <Link href="/sovereign/library" className="text-xs text-[#2563eb] font-medium hover:underline">
                  View All
                </Link>
              </div>
              <div className="space-y-4">
                {recentDocuments.map((doc) => {
                  const Icon = doc.icon
                  return (
                    <Link
                      key={doc.id}
                      href="/sovereign/library"
                      className="flex items-start gap-3 hover:bg-[#f8fafc] -mx-2 px-2 py-2 rounded-lg transition-colors"
                    >
                      <div className="h-10 w-10 rounded-lg bg-[#f8fafc] flex items-center justify-center flex-shrink-0">
                        <Icon className="h-5 w-5 text-[#6b7280]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-[#0f172a] truncate">{doc.title}</p>
                        <p className="text-xs text-[#6b7280]">{doc.modified}</p>
                      </div>
                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-1 rounded-full",
                          doc.status === "Complete"
                            ? "bg-green-100 text-green-700"
                            : "bg-[#2563eb]/10 text-[#2563eb]"
                        )}
                      >
                        {doc.status}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Automate Repetition */}
            <div className="bg-[#2563eb] rounded-xl p-6 text-white relative overflow-hidden">
              <div className="absolute top-4 right-4 text-6xl font-bold opacity-10">AI</div>
              <h3 className="font-bold text-lg mb-2">Automate Repetition</h3>
              <p className="text-sm text-white/80 mb-4">
                KiYaNi can automatically pull data
                from your recent spreadsheets to
                populate these reports.
              </p>
              <button
                onClick={handleAutoFill}
                disabled={isProcessing}
                className="rounded-lg bg-white px-4 py-2 font-medium text-[#2563eb] transition-colors hover:bg-[#f1f5f9] disabled:pointer-events-none disabled:opacity-50"
              >
                {isProcessing ? "Processing..." : "Try Auto-Fill"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
