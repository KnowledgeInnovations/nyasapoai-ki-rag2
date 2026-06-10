'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Send, Sparkles,
  AlertTriangle, CheckCircle2, Paperclip,
  Copy, Check, FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { uploadDocument } from '@/lib/uploadDocument'
import type { RAGResponse, Citation } from '@/types'
import MessageContent from './MessageContent'
import SourceViewer from './SourceViewer'

/* ── Types ────────────────────────────────────────────────── */
interface Message {
  role: 'user' | 'ai'
  text: string
  streaming?: boolean   // true while tokens are still arriving
  response?: RAGResponse
}

interface StoredMessage {
  role: 'user' | 'ai'
  text: string
  risks?: string[]
  recommendations?: string[]
}

interface HistoryItem {
  id: string
  query: string
  response: string
  risks: string[]
  recommendations: string[]
  messages: StoredMessage[] | null
  created_at: string
}

/* ── Shimmer skeleton ────────────────────────────────────── */
function ThinkingSkeleton() {
  return (
    <div className="flex gap-4">
      <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-black text-white shadow-sm shadow-brand/30 sm:flex">
        KI
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-4 py-3.5 shadow-sm sm:max-w-xl sm:px-5 sm:py-4">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-brand" />
          <span className="text-xs font-semibold text-gray-400">Knowledge Innovations AI is thinking…</span>
        </div>
        <div className="space-y-3">
          {[100, 88, 94, 72].map((pct, i) => (
            <div key={i} className="shimmer-line h-2.5 rounded-full bg-gray-100"
              style={{ width: `${pct}%`, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Strips the [ANSWER]/[RISKS]/[RECS] delimiters so copied text is clean prose
function cleanAnswerText(text: string) {
  return text
    .replace(/^\s*\[ANSWER\]\s*\n?/, '')
    .split('\n[RISKS]')[0]
    .split('\n[RECS]')[0]
    .trim()
}

/* ── Copy button ──────────────────────────────────────────── */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy message'}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600',
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

// Strips the "[Document: Title]" prefix injected for embedding context and
// collapses whitespace/newlines for a clean one-line preview
function previewText(text: string): string {
  return text.replace(/^\s*\[Document:[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim()
}

const SOURCES_PREVIEW_COUNT = 6

/* ── Sources list ─────────────────────────────────────────── */
function SourcesList({ text, citations, onCiteClick }: {
  text: string
  citations: Citation[]
  onCiteClick: (c: Citation) => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (citations.length === 0) return null

  // Only show sources actually referenced by a [n] marker in the answer —
  // broad/aggregation queries can retrieve dozens of chunks for context but
  // most are never cited, so listing all of them is just noise.
  const cited = citations.filter((_, i) => new RegExp(`\\[${i + 1}\\]`).test(text))
  const list = cited.length > 0 ? cited : citations

  const visible = expanded ? list : list.slice(0, SOURCES_PREVIEW_COUNT)
  const hiddenCount = list.length - visible.length

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3.5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
        Sources ({list.length})
      </p>
      <div className="space-y-1">
        {visible.map((c, i) => (
          <button
            key={c.id ?? i}
            type="button"
            onClick={() => onCiteClick(c)}
            className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-black text-brand">
              {citations.indexOf(c) + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-gray-700">{c.document_title}</span>
              <span className="line-clamp-2 text-[11px] leading-snug text-gray-400">{previewText(c.chunk_text)}</span>
            </span>
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 px-2 text-[11px] font-semibold text-brand hover:text-brand-dark"
        >
          Show {hiddenCount} more {hiddenCount === 1 ? 'source' : 'sources'}
        </button>
      )}
      {expanded && list.length > SOURCES_PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1.5 px-2 text-[11px] font-semibold text-gray-400 hover:text-gray-600"
        >
          Show less
        </button>
      )}
    </div>
  )
}

/* ── Message bubble ──────────────────────────────────────── */
function MessageBubble({
  msg, onCiteClick,
}: {
  msg: Message
  onCiteClick: (c: Citation) => void
}) {
  const citations = msg.response?.citations ?? []

  return (
    <div className={cn('group flex', msg.role === 'user' && 'justify-end')}>
      <div className="min-w-0 flex-1 space-y-3 sm:max-w-3xl">
        {/* Bubble */}
        <div className={cn(
          'relative rounded-2xl px-5 py-4',
          msg.role === 'user'
            ? 'rounded-tr-sm bg-brand text-white text-sm leading-relaxed'
            : 'rounded-tl-sm border border-gray-200 bg-white shadow-sm',
        )}>
          {msg.role === 'user' ? (
            <span className="text-sm leading-relaxed">{msg.text}</span>
          ) : (
            <>
              <MessageContent
                text={msg.text}
                citations={citations}
                onCiteClick={onCiteClick}
              />
              {msg.streaming && (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-full bg-gray-400 align-middle" />
              )}
            </>
          )}

          {/* Copy — visible on hover (desktop) or always on touch */}
          {!msg.streaming && (
            <CopyButton
              text={msg.role === 'user' ? msg.text : cleanAnswerText(msg.text)}
              className={cn(
                'absolute -top-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 sm:bg-white sm:shadow-sm sm:border sm:border-gray-100',
                msg.role === 'user' ? '-left-2' : '-right-2',
              )}
            />
          )}
        </div>

        {/* Risks */}
        {msg.response?.risks && msg.response.risks.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> Risks identified
            </p>
            <ul className="space-y-1">
              {msg.response.risks.map((r, ri) => <li key={ri} className="text-xs text-amber-700">• {r}</li>)}
            </ul>
          </div>
        )}

        {/* Recommendations */}
        {msg.response?.recommendations && msg.response.recommendations.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> Recommendations
            </p>
            <ul className="space-y-1">
              {msg.response.recommendations.map((r, ri) => <li key={ri} className="text-xs text-emerald-700">• {r}</li>)}
            </ul>
          </div>
        )}

        {/* Sources */}
        {!msg.streaming && <SourcesList text={msg.text} citations={citations} onCiteClick={onCiteClick} />}
      </div>
    </div>
  )
}

/* ── Welcome screen ──────────────────────────────────────── */
const SUGGESTIONS = [
  { text: 'What are our top project risks this quarter?',        category: 'Risk' },
  { text: 'Summarise the latest board report',                   category: 'Summary' },
  { text: 'Which contracts are expiring in the next 90 days?',  category: 'Legal' },
  { text: 'What is the current status of our flagship project?', category: 'Projects' },
]

function WelcomeScreen({ greeting, firstName, onSuggest }: {
  greeting: string; firstName: string; onSuggest: (q: string) => void
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <h2 className="text-center text-2xl font-extrabold text-gray-900">{greeting}, {firstName}</h2>
        <p className="mt-1.5 text-center text-sm text-gray-500">
          Ask anything across your Knowledge Innovations documents.
        </p>

        {/* Always 2×2 grid — works on all screen sizes */}
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          {SUGGESTIONS.map(s => (
            <button key={s.text} onClick={() => onSuggest(s.text)}
              className="group flex flex-col items-start rounded-2xl border border-gray-200 bg-white p-3.5 text-left shadow-sm transition hover:border-brand/30 hover:bg-brand-light/40 hover:shadow-md active:scale-[0.98]">
              <span className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand">{s.category}</span>
              <p className="text-xs leading-snug text-gray-700">{s.text}</p>
            </button>
          ))}
        </div>

        <p className="mt-5 hidden text-center text-xs text-gray-400 sm:block">
          Press <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">Enter</kbd> to send ·{' '}
          <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────── */
export default function AskInterface({ userName = 'there' }: { userName?: string }) {
  const [messages,      setMessages]      = useState<Message[]>([])
  const [input,         setInput]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [uploading,     setUploading]     = useState(false)
  // Tracks the convId of the first message in the current session.
  // null = new session (next message will create a sidebar entry).
  // set  = active session (subsequent messages won't add new sidebar entries).
  const [sessionConvId, setSessionConvId] = useState<string | null>(null)
  const [activeSource,  setActiveSource]  = useState<Citation | null>(null)

  const bottomRef    = useRef<HTMLDivElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const firstName = userName.split(/\s+/)[0]

  // Computed client-side only to avoid SSR/client hydration mismatch
  const [greeting, setGreeting] = useState('Hello')
  useEffect(() => {
    const h = new Date().getHours()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
  }, [])



  // Restore last active session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ki_last_session')
      if (!raw) return
      const { convId, messages: saved } = JSON.parse(raw) as {
        convId: string | null
        messages: StoredMessage[]
      }
      if (!Array.isArray(saved) || saved.length === 0) return
      // One-time restore of a previous session from localStorage on initial mount
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionConvId(convId ?? null)
      setMessages(saved.map(m => ({
        role: m.role,
        text: m.text,
        ...(m.role === 'ai' && {
          response: {
            answer:           m.text,
            citations:        [],
            risks:            m.risks ?? [],
            recommendations:  m.recommendations ?? [],
            confidence_score: 0,
          },
        }),
      })))
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist active session whenever it changes — even before the first
  // response finishes (sessionConvId may still be null), so a refresh or
  // accidental reload never wipes out the conversation in progress.
  useEffect(() => {
    if (messages.length === 0) return
    try {
      const storable = messages.map(m => ({
        role:            m.role,
        // A message can still be mid-stream when this fires (e.g. the user
        // refreshes before [done] arrives) — persist whatever text has
        // arrived so far rather than dropping the message entirely.
        text:            m.text,
        risks:           m.response?.risks,
        recommendations: m.response?.recommendations,
      }))
      localStorage.setItem('ki_last_session', JSON.stringify({ convId: sessionConvId, messages: storable }))
    } catch {}
  }, [sessionConvId, messages])

  // Listen for sidebar "New Chat"
  useEffect(() => {
    const handler = () => {
      setMessages([])
      setSessionConvId(null)
      try { localStorage.removeItem('ki_last_session') } catch {}
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
    window.addEventListener('new-chat', handler)
    return () => window.removeEventListener('new-chat', handler)
  }, [])

  // Listen for sidebar conversation click
  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent<HistoryItem>).detail
      setSessionConvId(item.id)

      if (item.messages && item.messages.length > 0) {
        // Restore full multi-turn thread from the DB messages column
        setMessages(item.messages.map(m => ({
          role: m.role,
          text: m.text,
          ...(m.role === 'ai' && {
            response: {
              answer:           m.text,
              citations:        [],
              risks:            m.risks ?? [],
              recommendations:  m.recommendations ?? [],
              confidence_score: 0,
            },
          }),
        })))
      } else {
        // Fallback for old conversations recorded before this migration
        setMessages([
          { role: 'user', text: item.query },
          {
            role: 'ai',
            text: item.response,
            response: {
              answer:           item.response,
              citations:        [],
              risks:            item.risks ?? [],
              recommendations:  item.recommendations ?? [],
              confidence_score: 0,
            },
          },
        ])
      }
    }
    window.addEventListener('open-conversation', handler)
    return () => window.removeEventListener('open-conversation', handler)
  }, [])

  // Auto-scroll to the newest message — but only if the user is already
  // near the bottom, so they can freely scroll up to read earlier messages
  // while the AI is still streaming a response.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const NEAR_BOTTOM_PX = 120
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (isNearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setMessages(prev => [...prev, { role: 'user', text: `📎 ${file.name}` }])
    setUploading(true)
    try {
      const { document, error } = await uploadDocument(file)
      if (document) {
        setMessages(prev => [...prev, {
          role: 'ai',
          text: `Great news! I've successfully processed **${file.name}**. You can now ask me questions about its contents. 🎉`,
        }])
      } else {
        const msg = error === 'Insufficient permissions'
          ? "I'm sorry, your account doesn't have permission to upload documents. Please contact your workspace admin."
          : `I had trouble processing that file. ${error ?? 'Please try again from the Documents section.'}`
        setMessages(prev => [...prev, { role: 'ai', text: msg }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Something went wrong with the upload. Please try again.' }])
    } finally {
      setUploading(false)
    }
  }

  async function submit(query: string) {
    const q = query.trim()
    if (!q || loading || uploading) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setLoading(true)
    try {
      const isNewSession = sessionConvId === null

      // Full conversation history — the AI sees everything said in this session.
      const history = messages
        .filter(m => !m.streaming)
        .map(m => ({
          role:    m.role === 'user' ? 'user' : 'assistant',
          content: m.role === 'ai' && m.response?.answer
            ? m.response.answer   // use the clean final answer, not raw delimited text
            : m.text,
        }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, newSession: isNewSession, history, convId: sessionConvId }),
      })
      if (!res.ok || !res.body) throw new Error('Request failed')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let streamText = ''
      let aiMsgAdded = false
      let receivedDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: { t?: string; done?: boolean; answer?: string; risks?: string[]; recommendations?: string[]; citations?: RAGResponse['citations']; confidence_score?: number; convId?: string | null; title?: string }
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.t) {
            streamText += event.t
            if (!aiMsgAdded) {
              // First token — add the streaming message, hide the skeleton
              setMessages(prev => [...prev, { role: 'ai', text: streamText, streaming: true }])
              setLoading(false)
              aiMsgAdded = true
            } else {
              setMessages(prev => [
                ...prev.slice(0, -1),
                { role: 'ai', text: streamText, streaming: true },
              ])
            }
          }

          if (event.done) {
            receivedDone = true
            const finalMsg: Message = {
              role: 'ai',
              text: event.answer ?? '',
              streaming: false,
              response: {
                answer:           event.answer ?? '',
                citations:        event.citations ?? [],
                risks:            event.risks ?? [],
                recommendations:  event.recommendations ?? [],
                confidence_score: event.confidence_score ?? 0.85,
              },
            }
            setMessages(prev => [...prev.slice(0, -1), finalMsg])
            if (isNewSession && event.convId) {
              setSessionConvId(event.convId)
              window.dispatchEvent(new CustomEvent('refresh-chat-history'))
            }
          }
        }
      }

      // Stream ended without a [done] event (e.g. connection cut short) —
      // finalize whatever text arrived so the message isn't stuck in a
      // permanent "streaming" state and silently dropped on next refresh.
      if (aiMsgAdded && !receivedDone) {
        setMessages(prev => [
          ...prev.slice(0, -1),
          { role: 'ai', text: streamText, streaming: false },
        ])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'ai',
        text: "I'm sorry, something didn't go quite right. Please try again and I'll do my best to help.",
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">

      {/* Messages — min-h-0 fixes flex overflow on iOS Safari */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-[#f8f9fc]" style={{ WebkitOverflowScrolling: 'touch' }}>
        {messages.length === 0 ? (
          <WelcomeScreen greeting={greeting} firstName={firstName} onSuggest={submit} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onCiteClick={setActiveSource} />
            ))}
            {/* Show skeleton only before first token arrives (last msg is still from user) */}
            {loading && messages[messages.length - 1]?.role === 'user' && <ThinkingSkeleton />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Source viewer — slides in when a citation is clicked */}
      <SourceViewer citation={activeSource} onClose={() => setActiveSource(null)} />

      {/* Input bar */}
      <div className="shrink-0 border-t border-gray-100 bg-white/95 p-4 backdrop-blur-sm">
        <form onSubmit={e => { e.preventDefault(); submit(input) }} className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-gray-50/80 px-3 py-3 shadow-sm transition-all focus-within:border-brand/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/10">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              disabled={uploading} title="Attach a document"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition hover:bg-gray-100 hover:text-brand disabled:opacity-40">
              {uploading
                ? <Sparkles className="h-4 w-4 animate-pulse text-brand" />
                : <Paperclip className="h-4 w-4" />}
            </button>
            <textarea
              ref={textareaRef} rows={1} value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) } }}
              placeholder="Ask anything about your Knowledge Innovations documents…"
              className="flex-1 resize-none bg-transparent text-base text-gray-900 placeholder-gray-400 focus:outline-none sm:text-sm"
              style={{ minHeight: '24px', maxHeight: '120px', fontSize: '16px' }}
            />
            <button type="submit" disabled={!input.trim() || loading || uploading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-md shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-30 disabled:shadow-none">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
