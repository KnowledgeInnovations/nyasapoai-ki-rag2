"use client"

import { useState, useRef, useCallback } from "react"
import {
  Bot,
  User,
  Zap,
  CheckCircle,
  FileText,
  ExternalLink,
  Shield,
  Upload,
  Send,
  Paperclip,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  id: number
  type: "user" | "assistant"
  content: string
  verified?: boolean
  partial?: boolean
}

interface ReferenceDocument {
  id: number
  title: string
  description: string
  tag?: string
  updated?: string
  image?: boolean
  icon?: typeof Shield
}

const referenceDocuments: ReferenceDocument[] = [
  {
    id: 1,
    title: "GT-2024-X: Transformation",
    description: "Comprehensive framework for national digital infrastructure expansion 2024-2030.",
    tag: "POLICY",
    updated: "Updated 2h ago",
  },
  {
    id: 2,
    title: "Infrastructure Map v2",
    description: "Fiber-optic backbone distribution map for all regional capitals.",
    image: true,
  },
  {
    id: 3,
    title: "Rural Access Data",
    description: "Statistical breakdown of internet penetration rates by district.",
    tag: "RAW DATA",
  },
  {
    id: 4,
    title: "Privacy Guidelines",
    description: "Data handling and citizen privacy protocols for digital services.",
    icon: Shield,
  },
]

const initialMessages: Message[] = [
  {
    id: 1,
    type: "user",
    content: "What are the latest updates on the Ghana Digital Transformation policy?",
  },
  {
    id: 2,
    type: "assistant",
    content: `The 2024 Digital Transformation update focuses on three core pillars:

Universal high-speed internet access for rural district assemblies.

The integration of AI-driven judicial processing tools.

Expansion of the e-levy framework to include cross-border digital services.`,
    verified: true,
  },
  {
    id: 3,
    type: "user",
    content: 'Can you summarize the "Universal Internet Access" section from the reference doc?',
  },
  {
    id: 4,
    type: "assistant",
    content: "According to the Reference Document #GT-2024-X, the initiative aims to provide universal high-speed internet access to all 261 district assemblies by 2028. Key milestones include: deployment of 500+ fiber nodes in underserved areas, establishment of 1,200 community digital centers, and training of 50,000 digital literacy ambassadors.",
    verified: true,
  },
]

// AI responses based on keywords
const aiResponses: Record<string, string> = {
  "policy": "Based on my analysis of the available policy documents, the Ghana Digital Transformation Policy 2024 emphasizes: (1) Universal broadband access, (2) Digital government services, (3) Cybersecurity frameworks, and (4) Data sovereignty principles. Would you like me to elaborate on any specific area?",
  "infrastructure": "The digital infrastructure expansion plan includes: fiber-optic backbone extension to all regional capitals, 5G network deployment in major cities, and satellite connectivity for remote areas. The total investment is projected at GH₵ 2.3 billion over 5 years.",
  "privacy": "The Privacy Guidelines document outlines citizen data protection protocols including: data minimization principles, consent-based data collection, secure data storage requirements, and citizen rights to access and delete personal data. These align with international data protection standards.",
  "rural": "Rural connectivity initiatives focus on: mesh network deployment in underserved districts, community digital hubs establishment, and mobile broadband tower installations. Currently, 34% of rural households lack reliable internet access, with a target of 85% coverage by 2028.",
  "ai": "The AI integration framework includes: natural language processing for local languages, document automation systems, and decision support analytics. KiYaNi AI Engine is the primary AI system, trained specifically on Ghanaian administrative contexts.",
  "budget": "The digital transformation budget allocation for 2024-2025 includes: GH₵ 450M for infrastructure, GH₵ 180M for digital services development, GH₵ 120M for capacity building, and GH₵ 50M for cybersecurity initiatives.",
  "default": "I understand your question. Based on my analysis of the available policy documents, I can provide you with relevant insights. The Ghana Digital Transformation initiative emphasizes sustainable infrastructure development with a focus on digital inclusion and data sovereignty. Could you provide more specific details about what aspect you'd like to explore?",
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const getAIResponse = (query: string): string => {
    const lowerQuery = query.toLowerCase()

    for (const [keyword, response] of Object.entries(aiResponses)) {
      if (keyword !== "default" && lowerQuery.includes(keyword)) {
        return response
      }
    }

    return aiResponses.default
  }

  const handleSend = () => {
    if (!inputValue.trim() && uploadedFiles.length === 0) return

    const newUserMessage: Message = {
      id: messages.length + 1,
      type: "user",
      content: uploadedFiles.length > 0
        ? `${inputValue} [Attached: ${uploadedFiles.map(f => f.name).join(", ")}]`
        : inputValue,
    }

    setMessages(prev => [...prev, newUserMessage])
    setInputValue("")
    setUploadedFiles([])
    setIsTyping(true)

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: messages.length + 2,
        type: "assistant",
        content: getAIResponse(newUserMessage.content),
        verified: true,
      }
      setMessages(prev => [...prev, aiResponse])
      setIsTyping(false)
      scrollToBottom()
    }, 1500)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadedFiles(prev => [...prev, ...Array.from(e.target.files!)])
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      setUploadedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)])
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleDocumentClick = (doc: ReferenceDocument) => {
    const query = `Tell me about ${doc.title}`
    setInputValue(query)
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Chat Area */}
          <div className="lg:col-span-2 flex flex-col h-[calc(100vh-180px)]">
            {/* Chat Header */}
            <div className="text-center mb-8 flex-shrink-0">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-[#2563eb] mb-4">
                <Bot className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-[#0f172a] mb-2">How can I help you today?</h1>
              <p className="text-[#64748b]">
                I am <span className="font-semibold text-[#0f172a]">NyasaPo</span> AI, your government policy and data specialist.
                <br />
                Ask me anything about current regulations or data insights.
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-6 mb-6 pr-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className="flex gap-3 justify-start"
                >
                  {message.type === "user" ? (
                    <>
                      <div className="h-10 w-10 rounded-full bg-[#f1f5f9] flex items-center justify-center flex-shrink-0">
                        <User className="h-5 w-5 text-[#6b7280]" />
                      </div>
                      <div className="bg-[#f8fafc] rounded-2xl rounded-tl-sm px-4 py-3 max-w-lg">
                        <p className="text-[#424656]">{message.content}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-[#2563eb] rounded-2xl rounded-tl-sm px-4 py-3 max-w-lg">
                        <p className="text-white whitespace-pre-line">{message.content}</p>
                        {message.verified && (
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/20">
                            <CheckCircle className="h-4 w-4 text-white/80" />
                            <span className="text-xs text-white/80 uppercase tracking-wide">
                              Verified by KiYaNi
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="h-10 w-10 rounded-full bg-[#2563eb] flex items-center justify-center flex-shrink-0">
                        <Zap className="h-5 w-5 text-white" />
                      </div>
                    </>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-3">
                  <div className="bg-[#2563eb] rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                      <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                      <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-[#2563eb] flex items-center justify-center flex-shrink-0">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Uploaded Files */}
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 bg-[#f1f5f9] rounded-lg px-3 py-1.5">
                    <FileText className="h-4 w-4 text-[#6b7280]" />
                    <span className="text-sm text-[#424656]">{file.name}</span>
                    <button onClick={() => removeFile(index)} className="text-[#6b7280] hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input Area */}
            <div className="bg-white rounded-2xl border border-[#e2e2e2] p-2 flex items-center gap-2 flex-shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                multiple
              />
              <button
                className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f8fafc]"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-5 w-5" />
              </button>
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask KiYaNi AI about policies..."
                className="flex-1 border-none bg-transparent px-2 text-sm text-[#0f172a] outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() && uploadedFiles.length === 0}
                className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-6 py-2 font-medium text-white transition-colors hover:bg-[#004fcb] disabled:pointer-events-none disabled:opacity-50"
              >
                Process <Send className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Reference Documents Sidebar */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#6b7280]" />
                <h2 className="font-semibold text-[#0f172a]">Reference Documents</h2>
              </div>
              <span className="text-xs font-medium text-[#2563eb] bg-[#2563eb]/10 px-2 py-1 rounded-full">
                {referenceDocuments.length} Docs
              </span>
            </div>

            <div className="space-y-3">
              {referenceDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleDocumentClick(doc)}
                  className="w-full text-left bg-white rounded-xl border border-[#e2e2e2] p-4 hover:border-[#2563eb] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-sm text-[#0f172a]">{doc.title}</h3>
                    <ExternalLink className="h-4 w-4 text-[#6b7280]" />
                  </div>
                  <p className="text-xs text-[#6b7280] mb-3">{doc.description}</p>
                  {doc.image && (
                    <div className="bg-[#0f172a] rounded-lg h-24 mb-3 relative overflow-hidden">
                      <div className="absolute inset-0 opacity-50">
                        <svg viewBox="0 0 200 100" className="w-full h-full">
                          <path d="M 0 80 Q 50 60, 100 50 T 200 30" fill="none" stroke="#2563eb" strokeWidth="2" />
                          <circle cx="50" cy="70" r="3" fill="#2563eb" />
                          <circle cx="100" cy="50" r="3" fill="#2563eb" />
                          <circle cx="150" cy="40" r="3" fill="#2563eb" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {doc.tag && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#424656] bg-[#f1f5f9] px-2 py-1 rounded">
                        {doc.tag}
                      </span>
                      {doc.updated && (
                        <span className="text-xs text-[#6b7280]">{doc.updated}</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                "border-2 border-dashed rounded-xl p-6 text-center transition-colors",
                isDragOver
                  ? "border-[#2563eb] bg-[#2563eb]/5"
                  : "border-[#e2e2e2] hover:border-[#2563eb]"
              )}
            >
              <Upload className={cn(
                "h-6 w-6 mx-auto mb-2",
                isDragOver ? "text-[#2563eb]" : "text-[#6b7280]"
              )} />
              <p className="text-sm text-[#6b7280]">
                {isDragOver ? "Drop files here" : "Drop local files to query"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
