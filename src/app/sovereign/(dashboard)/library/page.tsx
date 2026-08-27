"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Search,
  FileText,
  Shield,
  CheckCircle,
  Clock,
  Plus,
  MoreVertical,
  Download,
  Trash2,
  Edit,
  Eye,
  Copy
} from "lucide-react"
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/sovereign/Dropdown"
import { Modal } from "@/components/sovereign/Modal"
import { cn } from "@/lib/utils"

interface Document {
  id: number
  title: string
  description: string
  content: string
  modified: string
  status: "Draft" | "Complete" | "Review"
  icon: typeof FileText
  category: string
}

const initialDocuments: Document[] = [
  {
    id: 1,
    title: "Q4 Infrastructure Report",
    description: "Comprehensive analysis of digital infrastructure expansion across all regions",
    content: "This report provides a comprehensive analysis of the digital infrastructure expansion initiatives undertaken across all regions during Q4 2024...",
    modified: "Modified 2h ago",
    status: "Draft",
    icon: FileText,
    category: "Reports",
  },
  {
    id: 2,
    title: "Cybersecurity Protocol v2",
    description: "Updated security guidelines for government digital services",
    content: "Version 2.0 of the Cybersecurity Protocol establishes enhanced security guidelines for all government digital services...",
    modified: "Modified 5h ago",
    status: "Complete",
    icon: Shield,
    category: "Policies",
  },
  {
    id: 3,
    title: "Privacy Policy Update",
    description: "Data handling and citizen privacy protocols for digital services",
    content: "This policy update outlines the data handling procedures and citizen privacy protocols that must be followed by all digital service providers...",
    modified: "Modified Yesterday",
    status: "Draft",
    icon: CheckCircle,
    category: "Policies",
  },
  {
    id: 4,
    title: "Digital Transformation Roadmap",
    description: "Strategic plan for national digital transformation 2024-2030",
    content: "The Digital Transformation Roadmap 2024-2030 outlines the strategic initiatives and milestones for achieving a fully digital government...",
    modified: "Modified 2 days ago",
    status: "Complete",
    icon: FileText,
    category: "Strategy",
  },
  {
    id: 5,
    title: "AI Integration Guidelines",
    description: "Framework for implementing AI solutions in public services",
    content: "These guidelines provide a comprehensive framework for the ethical and effective implementation of AI solutions in public services...",
    modified: "Modified 3 days ago",
    status: "Review",
    icon: FileText,
    category: "Guidelines",
  },
  {
    id: 6,
    title: "Rural Connectivity Assessment",
    description: "Analysis of internet penetration in rural districts",
    content: "This assessment analyzes the current state of internet penetration across rural districts and identifies key areas for improvement...",
    modified: "Modified 1 week ago",
    status: "Complete",
    icon: FileText,
    category: "Reports",
  },
]

const categories = ["All", "Reports", "Policies", "Strategy", "Guidelines"]

export default function LibraryPage() {
  const router = useRouter()
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState("All")
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Document | null>(null)

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === "All" || doc.category === activeCategory
    return matchesSearch && matchesCategory
  })

  const handleEdit = (doc: Document) => {
    // Navigate to dashboard with doc context (in real app, would pass doc ID)
    router.push("/sovereign/dashboard")
  }

  const handleDownload = (doc: Document) => {
    const content = `${doc.title}\n\n${doc.description}\n\n${doc.content}`
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${doc.title.toLowerCase().replace(/\s+/g, "-")}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = (doc: Document) => {
    setDeleteConfirm(doc)
  }

  const confirmDelete = () => {
    if (deleteConfirm) {
      setDocuments(documents.filter(d => d.id !== deleteConfirm.id))
      setDeleteConfirm(null)
    }
  }

  const handleDuplicate = (doc: Document) => {
    const newDoc: Document = {
      ...doc,
      id: Math.max(...documents.map(d => d.id)) + 1,
      title: `${doc.title} (Copy)`,
      modified: "Just now",
      status: "Draft",
    }
    setDocuments([newDoc, ...documents])
  }

  const handlePreview = (doc: Document) => {
    setPreviewDoc(doc)
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#0f172a] mb-2">Document Library</h1>
            <p className="text-[#64748b]">
              Manage and access all your policy documents, reports, and guidelines.
            </p>
          </div>
          <Link
            href="/sovereign/dashboard"
            className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#004fcb]"
          >
            <Plus className="h-4 w-4" />
            New Document
          </Link>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="w-full rounded-lg border border-[#e2e2e2] bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  activeCategory === category
                    ? "bg-[#2563eb] hover:bg-[#004fcb] text-white"
                    : "border border-[#e2e2e2] text-[#424656] hover:bg-[#f8fafc]"
                )}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <p className="text-sm text-[#6b7280] mb-4">
          Showing {filteredDocuments.length} of {documents.length} documents
        </p>

        {/* Documents Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => {
            const Icon = doc.icon
            return (
              <div
                key={doc.id}
                className="bg-white rounded-xl border border-[#e2e2e2] p-6 hover:border-[#2563eb] transition-colors cursor-pointer group"
                onClick={() => handlePreview(doc)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-lg bg-[#f8fafc] flex items-center justify-center">
                    <Icon className="h-6 w-6 text-[#6b7280]" />
                  </div>
                  <Dropdown
                    trigger={
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg p-2 text-[#6b7280] opacity-0 transition-opacity hover:bg-[#f8fafc] group-hover:opacity-100"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    }
                  >
                    <DropdownItem onClick={(e) => { e.stopPropagation(); handlePreview(doc); }}>
                      <Eye className="h-4 w-4 mr-2" /> Preview
                    </DropdownItem>
                    <DropdownItem onClick={(e) => { e.stopPropagation(); handleEdit(doc); }}>
                      <Edit className="h-4 w-4 mr-2" /> Edit
                    </DropdownItem>
                    <DropdownItem onClick={(e) => { e.stopPropagation(); handleDuplicate(doc); }}>
                      <Copy className="h-4 w-4 mr-2" /> Duplicate
                    </DropdownItem>
                    <DropdownItem onClick={(e) => { e.stopPropagation(); handleDownload(doc); }}>
                      <Download className="h-4 w-4 mr-2" /> Download
                    </DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem
                      onClick={(e) => { e.stopPropagation(); handleDelete(doc); }}
                      className="text-red-600"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownItem>
                  </Dropdown>
                </div>
                <h3 className="font-semibold text-[#0f172a] mb-2">{doc.title}</h3>
                <p className="text-sm text-[#6b7280] mb-4 line-clamp-2">{doc.description}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-[#6b7280]">
                    <Clock className="h-3 w-3" />
                    {doc.modified}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      doc.status === "Complete"
                        ? "bg-green-100 text-green-700"
                        : doc.status === "Review"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-[#2563eb]/10 text-[#2563eb]"
                    )}
                  >
                    {doc.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {filteredDocuments.length === 0 && (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-[#e2e2e2] mx-auto mb-4" />
            <p className="text-[#6b7280] mb-4">No documents found matching your criteria.</p>
            <button
              onClick={() => { setSearchQuery(""); setActiveCategory("All"); }}
              className="rounded-lg border border-[#e2e2e2] px-4 py-2 font-medium text-[#424656] transition-colors hover:bg-[#f8fafc]"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Preview Dialog */}
      <Modal
        open={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.title}
        description={previewDoc?.description}
        className="max-w-2xl"
        footer={
          <>
            <button
              onClick={() => setPreviewDoc(null)}
              className="rounded-lg border border-[#e2e2e2] px-4 py-2 text-sm font-medium text-[#424656] transition-colors hover:bg-[#f8fafc]"
            >
              Close
            </button>
            <button
              onClick={() => { setPreviewDoc(null); if (previewDoc) handleEdit(previewDoc); }}
              className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#004fcb]"
            >
              <Edit className="h-4 w-4" /> Edit Document
            </button>
          </>
        }
      >
        <div className="py-4">
          <div className="flex items-center gap-4 mb-4">
            <span className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              previewDoc?.status === "Complete"
                ? "bg-green-100 text-green-700"
                : previewDoc?.status === "Review"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-[#2563eb]/10 text-[#2563eb]"
            )}>
              {previewDoc?.status}
            </span>
            <span className="text-xs text-[#6b7280]">{previewDoc?.modified}</span>
            <span className="text-xs text-[#6b7280] bg-[#f1f5f9] px-2 py-1 rounded">{previewDoc?.category}</span>
          </div>
          <p className="text-[#424656] leading-relaxed">{previewDoc?.content}</p>
        </div>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Document"
        description={`Are you sure you want to delete "${deleteConfirm?.title}"? This action cannot be undone.`}
        footer={
          <>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="rounded-lg border border-[#e2e2e2] px-4 py-2 text-sm font-medium text-[#424656] transition-colors hover:bg-[#f8fafc]"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </>
        }
      />
    </div>
  )
}
