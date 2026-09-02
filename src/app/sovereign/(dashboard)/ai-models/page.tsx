"use client"

import { useState, useRef } from "react"
import {
  Globe,
  Languages,
  Mic,
  Volume2,
  Copy,
  Share2,
  Zap,
  Clock,
  Database,
  Users,
  Sparkles,
  Check,
  MicOff
} from "lucide-react"
import { cn } from "@/lib/utils"

const sourceLanguages = [
  { value: "en-uk", label: "English (UK)" },
  { value: "en-us", label: "English (US)" },
  { value: "fr", label: "French" },
]

const targetLanguages = [
  { value: "twi-asante", label: "Twi (Asante)" },
  { value: "twi-akuapem", label: "Twi (Akuapem)" },
  { value: "ga", label: "Ga" },
  { value: "ewe", label: "Ewe" },
  { value: "dagbani", label: "Dagbani" },
  { value: "hausa", label: "Hausa" },
]

// Sample translations
const translations: Record<string, Record<string, string>> = {
  "twi-asante": {
    "hello": "Mema wo akye",
    "good morning": "Mema wo akye",
    "how are you": "Wo ho te sɛn?",
    "how are you?": "Wo ho te sɛn?",
    "thank you": "Meda wo ase",
    "welcome": "Akwaaba",
    "the government policy": "Ɔman no nhyehyɛe",
    "i am fine": "Me ho yɛ",
    "goodbye": "Nante yie",
    "please": "Mepa wo kyɛw",
    "yes": "Aane",
    "no": "Daabi",
    "what is your name": "Wo din de sɛn?",
    "my name is": "Me din de",
    "good evening": "Meema wo adwo",
    "good night": "Da yie",
  },
  "twi-akuapem": {
    "hello": "Maakye",
    "good morning": "Maakye",
    "how are you": "Wo ho te sɛn?",
    "thank you": "Meda wo ase",
    "welcome": "Akwaaba",
  },
  "ga": {
    "hello": "Ojekoo",
    "good morning": "Ojekoo",
    "how are you": "Te oyiwalaŋŋ?",
    "thank you": "Oyiwaladon",
    "welcome": "Akwaaba",
  },
  "ewe": {
    "hello": "Woezor",
    "good morning": "Ŋdi na mi",
    "how are you": "Efɔa?",
    "thank you": "Akpe",
    "welcome": "Woezon",
  },
  "dagbani": {
    "hello": "Dasiba",
    "good morning": "Antire",
    "how are you": "A wula?",
    "thank you": "Naawuni ni ti",
    "welcome": "Maraba",
  },
  "hausa": {
    "hello": "Sannu",
    "good morning": "Ina kwana",
    "how are you": "Yaya dai?",
    "thank you": "Na gode",
    "welcome": "Maraba",
  },
}

const stats = [
  { icon: Clock, value: "0.8s", label: "AVERAGE LATENCY", color: "bg-[#2563eb]" },
  { icon: Database, value: "2.4M", label: "TRAINING TOKENS", color: "bg-[#2563eb]" },
  { icon: Users, value: "12", label: "SUPPORTED DIALECTS", color: "bg-[#2563eb]" },
]

export default function AIModelsPage() {
  const [sourceText, setSourceText] = useState("")
  const [translatedText, setTranslatedText] = useState("")
  const [sourceLanguage, setSourceLanguage] = useState("en-uk")
  const [targetLanguage, setTargetLanguage] = useState("twi-asante")
  const [isTranslating, setIsTranslating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [contextPulse, setContextPulse] = useState("Engine detected formal Ashanti Twi nuances. Translation will prioritize royal honorifics for maximum accuracy in governmental policy documents.")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleTranslate = () => {
    if (!sourceText.trim()) return

    setIsTranslating(true)

    // Simulate translation with actual translations
    setTimeout(() => {
      const langTranslations = translations[targetLanguage] || translations["twi-asante"]
      const lowercaseInput = sourceText.toLowerCase().trim()

      // Check for exact match
      if (langTranslations[lowercaseInput]) {
        setTranslatedText(langTranslations[lowercaseInput])
      } else {
        // Try to translate word by word
        const words = sourceText.split(" ")
        const translatedWords = words.map(word => {
          const lowerWord = word.toLowerCase()
          return langTranslations[lowerWord] || word
        })
        setTranslatedText(translatedWords.join(" "))
      }

      // Update context pulse based on target language
      if (targetLanguage === "twi-asante") {
        setContextPulse("Engine detected formal Ashanti Twi nuances. Translation will prioritize royal honorifics for maximum accuracy in governmental policy documents.")
      } else if (targetLanguage === "ga") {
        setContextPulse("Ga language mode activated. Translation optimized for Greater Accra regional context with formal administrative terminology.")
      } else if (targetLanguage === "ewe") {
        setContextPulse("Ewe Belt dialect detected. Translation configured for Volta Region administrative documents with appropriate tonal markers.")
      } else {
        setContextPulse(`Translation engine configured for ${targetLanguages.find(l => l.value === targetLanguage)?.label}. Context-aware processing enabled.`)
      }

      setIsTranslating(false)
    }, 800)
  }

  const handleCopy = async () => {
    if (!translatedText) return
    await navigator.clipboard.writeText(translatedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = async () => {
    if (!translatedText) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: "NyansaPo Translation",
          text: `Original: ${sourceText}\n\nTranslation (${targetLanguages.find(l => l.value === targetLanguage)?.label}): ${translatedText}`,
        })
      } catch {
        // User cancelled or share failed
      }
    } else {
      // Fallback to copy
      handleCopy()
    }
  }

  const handleSpeak = () => {
    if (!translatedText || !("speechSynthesis" in window)) return

    setIsSpeaking(true)
    const utterance = new SpeechSynthesisUtterance(translatedText)
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    speechSynthesis.speak(utterance)
  }

  const handleMicToggle = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      alert("Speech recognition is not supported in this browser.")
      return
    }

    setIsRecording(!isRecording)

    if (!isRecording) {
      // Simulate recording - in production, use Web Speech API
      setTimeout(() => {
        setSourceText("How are you?")
        setIsRecording(false)
      }, 2000)
    }
  }

  const handleSwapLanguages = () => {
    // Only swap if we have a translation
    if (translatedText) {
      setSourceText(translatedText)
      setTranslatedText(sourceText)
    }
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-2">
          <span className="text-[#6b7280]">AI Models</span>
          <span className="text-[#6b7280]">&gt;</span>
          <span className="text-[#2563eb] font-medium">Multilingual Translation</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-[#0f172a] mb-2">NyansaPo Translation Engine</h1>
        <p className="text-[#64748b] mb-8 max-w-2xl">
          A specialized neural translation module optimized for the distinct grammatical
          structures of Ghanaian languages including Twi, Ga, and Ewe.
        </p>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Translation Area */}
          <div className="lg:col-span-2">
            {/* Language Selectors */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-4 w-4 text-[#6b7280]" />
                  <span className="text-xs font-semibold text-[#6b7280] uppercase">Source</span>
                </div>
                <select
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e2e2] bg-white px-3 py-2 text-sm text-[#0f172a] outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                >
                  {sourceLanguages.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="mt-6 rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f8fafc] disabled:pointer-events-none disabled:opacity-50"
                onClick={handleSwapLanguages}
                disabled={!translatedText}
              >
                <Languages className="h-5 w-5" />
              </button>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Languages className="h-4 w-4 text-[#6b7280]" />
                  <span className="text-xs font-semibold text-[#6b7280] uppercase">Target</span>
                </div>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e2e2] bg-white px-3 py-2 text-sm text-[#0f172a] outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                >
                  {targetLanguages.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Translation Boxes */}
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {/* Source Input */}
              <div className="bg-white rounded-xl border border-[#e2e2e2] p-4 min-h-[300px] flex flex-col">
                <textarea
                  ref={textareaRef}
                  value={sourceText}
                  onChange={(e) => {
                    if (e.target.value.length <= 5000) {
                      setSourceText(e.target.value)
                    }
                  }}
                  placeholder="Type text to translate..."
                  className="flex-1 resize-none border-none focus:outline-none text-[#424656] placeholder:text-[#94a3b8]"
                />
                <div className="flex items-center justify-between pt-4 border-t border-[#e2e2e2]">
                  <span className="text-xs text-[#6b7280]">{sourceText.length} / 5000 characters</span>
                  <button
                    className={cn(
                      "rounded-lg p-2 transition-colors hover:bg-[#f8fafc]",
                      isRecording ? "text-red-500 animate-pulse" : "text-[#6b7280]"
                    )}
                    onClick={handleMicToggle}
                  >
                    {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Translation Output */}
              <div className="bg-[#f8fafc] rounded-xl border border-[#e2e2e2] p-4 min-h-[300px] flex flex-col">
                <div className="flex-1">
                  {isTranslating ? (
                    <div className="flex items-center gap-2 text-[#6b7280]">
                      <div className="h-4 w-4 border-2 border-[#2563eb] border-t-transparent rounded-full animate-spin" />
                      <span>Translating...</span>
                    </div>
                  ) : translatedText ? (
                    <p className="text-[#424656]">{translatedText}</p>
                  ) : (
                    <p className="text-[#94a3b8]">Translation will appear here...</p>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 pt-4 border-t border-[#e2e2e2]">
                  <button
                    className={cn(
                      "rounded-lg p-2 transition-colors hover:bg-[#f1f5f9] disabled:pointer-events-none disabled:opacity-50",
                      isSpeaking ? "text-[#2563eb]" : "text-[#6b7280]"
                    )}
                    onClick={handleSpeak}
                    disabled={!translatedText}
                  >
                    <Volume2 className="h-5 w-5" />
                  </button>
                  <button
                    className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f1f5f9] disabled:pointer-events-none disabled:opacity-50"
                    onClick={handleCopy}
                    disabled={!translatedText}
                  >
                    {copied ? <Check className="h-5 w-5 text-green-500" /> : <Copy className="h-5 w-5" />}
                  </button>
                  <button
                    className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f1f5f9] disabled:pointer-events-none disabled:opacity-50"
                    onClick={handleShare}
                    disabled={!translatedText}
                  >
                    <Share2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Translate Button */}
            <div className="flex justify-center mb-8">
              <button
                onClick={handleTranslate}
                disabled={!sourceText.trim() || isTranslating}
                className="flex items-center gap-2 rounded-full bg-[#2563eb] px-12 py-3 text-lg font-medium text-white transition-colors hover:bg-[#004fcb] disabled:pointer-events-none disabled:opacity-50"
              >
                {isTranslating ? "Translating..." : "Execute Translation"}
                <Zap className="h-5 w-5" />
              </button>
            </div>

            {/* Stats */}
            <div className="grid md:grid-cols-3 gap-4">
              {stats.map((stat) => {
                const Icon = stat.icon
                return (
                  <div key={stat.label} className="bg-white rounded-xl border border-[#e2e2e2] p-6">
                    <div className="h-10 w-10 rounded-lg bg-[#f1f5f9] flex items-center justify-center mb-4">
                      <Icon className="h-5 w-5 text-[#6b7280]" />
                    </div>
                    <p className="text-3xl font-bold text-[#0f172a] mb-1">{stat.value}</p>
                    <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wide">
                      {stat.label}
                    </p>
                    <div className={`h-1 ${stat.color} rounded-full mt-4`}></div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Linguistic Landscape */}
            <div className="bg-white rounded-xl border border-[#e2e2e2] p-6">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="h-5 w-5 text-[#6b7280]" />
                <h3 className="font-semibold text-[#0f172a] text-sm uppercase tracking-wide">
                  Linguistic Landscape
                </h3>
              </div>

              {/* Ghana Map Visualization */}
              <div className="relative bg-[#f8fafc] rounded-xl p-4 mb-4">
                <svg viewBox="0 0 200 180" className="w-full h-40">
                  {/* Simplified Ghana shape */}
                  <path
                    d="M60 20 L140 20 L150 60 L145 100 L130 140 L100 160 L70 140 L55 100 L50 60 Z"
                    fill="#FACC15"
                    stroke="#e2e2e2"
                    strokeWidth="2"
                  />
                  {/* Akan region */}
                  <ellipse cx="100" cy="60" rx="30" ry="25" fill="#22c55e" opacity="0.6" />
                  {/* Ewe region */}
                  <ellipse cx="120" cy="120" rx="20" ry="20" fill="#2563eb" opacity="0.6" />

                  {/* Labels */}
                  <rect x="65" y="45" width="70" height="20" fill="white" rx="4" />
                  <text x="100" y="58" textAnchor="middle" fontSize="8" fill="#0f172a" fontWeight="bold">
                    Akan Coverage: 47%
                  </text>

                  <rect x="95" y="125" width="50" height="16" fill="white" rx="4" />
                  <text x="120" y="136" textAnchor="middle" fontSize="7" fill="#0f172a">
                    Ewe Belt
                  </text>
                </svg>
              </div>

              {/* Precision Stats */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[#424656]">Model Precision</span>
                    <span className="text-sm font-bold text-[#2563eb]">94.2%</span>
                  </div>
                  <div className="h-2 bg-[#e2e2e2] rounded-full">
                    <div className="h-2 bg-[#2563eb] rounded-full transition-all duration-500" style={{ width: "94.2%" }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[#424656]">Dialect Coverage</span>
                    <span className="text-sm font-bold text-[#FACC15]">88.5%</span>
                  </div>
                  <div className="h-2 bg-[#e2e2e2] rounded-full">
                    <div className="h-2 bg-[#FACC15] rounded-full transition-all duration-500" style={{ width: "88.5%" }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Context Pulse */}
            <div className="bg-[#b3c5ff]/30 rounded-xl p-6 border border-[#2563eb]/20">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-5 w-5 text-[#2563eb]" />
                <h3 className="font-semibold text-[#0f172a]">NyansaPo Context Pulse</h3>
              </div>
              <p className="text-sm text-[#424656]">
                {contextPulse}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
