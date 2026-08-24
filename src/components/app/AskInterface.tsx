'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Send, Sparkles,
  AlertTriangle, CheckCircle2, Paperclip,
  Copy, Check, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { uploadDocument } from '@/lib/uploadDocument'
import type { RAGResponse, Citation } from '@/types'
import MessageContent from './MessageContent'
import AnswerChart from './AnswerChart'
import BarAnswerChart from './BarAnswerChart'
import SourceViewer, { fetchSourceDownloadUrl } from './SourceViewer'

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

/* ── Typing indicator ─────────────────────────────────────
   Shown the instant the user's message is sent, before the multi-pass
   retrieval/analysis pipeline produces a first token — a small bouncing-dot
   animation (Claude.ai-style), distinct from the shimmer skeleton below. */
function TypingIndicator() {
  return (
    <div className="flex">
      <div className="flex items-center gap-1 border border-gray-200 bg-white px-4 py-3">
        {[0, 1, 2].map(i => (
          <span key={i} className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-gray-400"
            style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )
}

/* ── Shimmer skeleton ────────────────────────────────────── */
function ThinkingSkeleton({ tenantName }: { tenantName: string }) {
  return (
    <div className="flex">
      <div className="min-w-0 flex-1 border border-gray-200 bg-white px-4 py-3.5 sm:max-w-3xl sm:px-5 sm:py-4">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-brand" />
          <span className="text-xs font-semibold text-gray-400">{tenantName} AI is thinking…</span>
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
        'inline-flex h-7 w-7 shrink-0 items-center justify-center text-gray-400 transition hover:bg-gray-100 hover:text-gray-600',
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

/* ── Confidence badge ─────────────────────────────────────── */
function ConfidenceBadge({ score, level }: { score?: number; level?: RAGResponse['confidence_level'] }) {
  if (score == null || level == null) return null

  const styles: Record<NonNullable<RAGResponse['confidence_level']>, string> = {
    High:   'bg-emerald-50 border-emerald-200 text-emerald-700',
    Medium: 'bg-amber-50 border-amber-200 text-amber-700',
    Low:    'bg-red-50 border-red-200 text-red-700',
  }

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 self-start border px-2.5 py-1 text-[11px] font-semibold',
      styles[level],
    )}>
      <ShieldCheck className="h-3 w-3" />
      Confidence: {score}% — {level}
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
    <div className={cn('msg-fade-in group flex', msg.role === 'user' && 'justify-end')}>
      <div className="min-w-0 max-w-[85%] space-y-3 sm:max-w-[70%]">
        {/* Bubble */}
        <div className={cn(
          'relative px-5 py-4',
          msg.role === 'user'
            ? 'bg-brand text-white text-sm leading-relaxed'
            : 'border border-gray-200 bg-white',
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

        {/* Chart */}
        {!msg.streaming && msg.response?.chart && (
          <AnswerChart data={msg.response.chart} />
        )}
        {!msg.streaming && !msg.response?.chart && msg.response?.bar_chart && (
          <BarAnswerChart data={msg.response.bar_chart} />
        )}

        {/* Risks */}
        {msg.response?.risks && msg.response.risks.length > 0 && (
          <div className="border border-amber-200 bg-amber-50 px-4 py-3.5">
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
          <div className="border border-emerald-200 bg-emerald-50 px-4 py-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> Recommendations
            </p>
            <ul className="space-y-1">
              {msg.response.recommendations.map((r, ri) => <li key={ri} className="text-xs text-emerald-700">• {r}</li>)}
            </ul>
          </div>
        )}

        {/* Confidence */}
        {!msg.streaming && (
          <ConfidenceBadge score={msg.response?.confidence_score} level={msg.response?.confidence_level} />
        )}

        {/* Sources are cited inline via [n] pills in the answer text
            (MessageContent) — no separate "Sources (N)" panel. */}
      </div>
    </div>
  )
}

/* ── Welcome screen ──────────────────────────────────────── */
function WelcomeScreen({ greeting, firstName, tenantName }: {
  greeting: string; firstName: string; tenantName: string
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 font-editorial-sans">
      <div className="w-full max-w-lg">
        <h2 className="font-editorial text-center text-2xl font-normal text-gray-900">{greeting}, {firstName}</h2>
        <p className="mt-1.5 text-center text-sm text-gray-500">
          Ask anything across your {tenantName} documents.
        </p>

        <p className="mt-5 hidden text-center text-xs text-gray-400 sm:block">
          Press <kbd className="border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> to send ·{' '}
          <kbd className="border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────── */
export default function AskInterface({ userName = 'there', tenantName = 'Nyansa AI' }: { userName?: string; tenantName?: string }) {
  const [messages,      setMessages]      = useState<Message[]>([])
  const [input,         setInput]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [uploading,     setUploading]     = useState(false)
  // Tracks the convId of the first message in the current session.
  // null = new session (next message will create a sidebar entry).
  // set  = active session (subsequent messages won't add new sidebar entries).
  // Shows the lightweight typing dots the instant `loading` becomes true;
  // after a short delay, swaps to the fuller shimmer skeleton — so the user
  // sees an immediate response while the accuracy pipeline (retrieval,
  // reranking, fact queries, analysis) is still working in the background.
  const [showThinkingSkeleton, setShowThinkingSkeleton] = useState(false)
  const [sessionConvId, setSessionConvId] = useState<string | null>(null)
  const sessionConvIdRef = useRef(sessionConvId)
  useEffect(() => { sessionConvIdRef.current = sessionConvId }, [sessionConvId])
  // Bumped whenever the user switches sessions (new chat / open another
  // conversation) while a response is still streaming. submit() captures the
  // value at start and checks it before every setMessages/setSessionConvId
  // call, so a reply that finishes after the user has navigated away doesn't
  // get applied to (and corrupt) the now-active conversation's messages.
  const streamGuardRef = useRef(0)
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
  }, [])

  // Restored sessions (from localStorage or the sidebar history) start with
  // empty citations on AI messages, so inline [n] markers aren't clickable.
  // Backfill them from the citations table whenever the active conversation
  // changes.
  useEffect(() => {
    if (!sessionConvId) return
    const convId = sessionConvId
    fetch(`/api/chat?citations=${convId}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        // If the user switched conversations before this resolved, don't
        // apply these citations to the now-active conversation's messages.
        if (convId !== sessionConvIdRef.current) return
        const citations: RAGResponse['citations'] = d.citations ?? []
        if (!citations.length) return

        // Group by the AI message that originally cited each chunk —
        // legacy rows (inserted before message_index existed) all belonged
        // to the first AI message (index 1).
        const byIndex = new Map<number, RAGResponse['citations']>()
        for (const c of citations) {
          const idx = c.message_index ?? 1
          const list = byIndex.get(idx)
          if (list) list.push(c)
          else byIndex.set(idx, [c])
        }

        setMessages(prev => prev.map((m, i) =>
          m.role === 'ai' && m.response && m.response.citations.length === 0 && byIndex.has(i)
            ? { ...m, response: { ...m.response, citations: byIndex.get(i)! } }
            : m
        ))
        for (const docId of new Set(citations.map(c => c.document_id))) {
          fetchSourceDownloadUrl(docId)
        }
      })
      .catch(() => {})
  }, [sessionConvId])

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
      streamGuardRef.current++
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
      streamGuardRef.current++
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

  // Flip from typing dots to the fuller shimmer skeleton ~500ms after
  // loading starts; reset immediately once loading ends.
  useEffect(() => {
    if (!loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowThinkingSkeleton(false)
      return
    }
    const t = setTimeout(() => setShowThinkingSkeleton(true), 500)
    return () => clearTimeout(t)
  }, [loading])

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
          text: `I've successfully processed **${file.name}**. You can now ask me questions about its contents.`,
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
    // Snapshot the session token — if the user switches to another chat (or
    // starts a new one) before this response finishes, streamGuardRef will
    // have moved on and we skip applying further updates to `messages`.
    const myGuard = streamGuardRef.current
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setLoading(true)
    // Declared outside the try block so the catch below can still tell
    // whether the real answer already arrived before some later error.
    let receivedDone = false
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
        body: JSON.stringify({ query: q, newSession: isNewSession, history, convId: sessionConvId, agentic: true }),
      })
      if (!res.ok || !res.body) {
        // Surface the server's specific message (e.g. rate-limit notice)
        // instead of a generic failure when one was provided.
        const text = await res.text().catch(() => '')
        throw new Error(text || 'Request failed')
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let streamText = ''
      let aiMsgAdded = false

      function processLine(line: string) {
        if (!line.startsWith('data: ')) return
        let event: { t?: string; retract?: boolean; done?: boolean; answer?: string; risks?: string[]; recommendations?: string[]; citations?: RAGResponse['citations']; chart?: RAGResponse['chart']; bar_chart?: RAGResponse['bar_chart']; confidence_score?: number; confidence_level?: RAGResponse['confidence_level']; convId?: string | null; title?: string }
        try { event = JSON.parse(line.slice(6)) } catch { return }

        // The user has switched to a different chat (or started a new one)
        // since this request was sent — the answer is still being persisted
        // server-side, but don't touch this component's `messages` state
        // (it now belongs to a different conversation).
        const stale = streamGuardRef.current !== myGuard

        // The agentic loop speculatively streamed some text assuming it was
        // the final answer, but a tool call turned up in the same turn —
        // that text wasn't the real answer. Discard it and go back to the
        // "working" state; the real answer's tokens (a fresh event.t burst)
        // follow once the loop settles.
        if (event.retract) {
          if (!stale) {
            if (aiMsgAdded) setMessages(prev => prev.slice(0, -1))
            setLoading(true)
          }
          streamText = ''
          aiMsgAdded = false
          return
        }

        if (event.t) {
          streamText += event.t
          if (!stale) {
            if (!aiMsgAdded) {
              // First token — add the streaming message, hide the skeleton
              setMessages(prev => [...prev, { role: 'ai', text: streamText, streaming: true }])
              setLoading(false)
            } else {
              setMessages(prev => [
                ...prev.slice(0, -1),
                { role: 'ai', text: streamText, streaming: true },
              ])
            }
          }
          if (!aiMsgAdded) aiMsgAdded = true
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
              confidence_score: event.confidence_score ?? 85,
              confidence_level: event.confidence_level,
              chart:            event.chart ?? null,
              bar_chart:        event.bar_chart ?? null,
            },
          }
          if (!stale) {
            if (aiMsgAdded) {
              setMessages(prev => [...prev.slice(0, -1), finalMsg])
            } else {
              // No tokens were streamed before "done" — append rather than
              // replace, so we don't clobber the user's just-submitted message.
              setMessages(prev => [...prev, finalMsg])
              setLoading(false)
            }
            for (const docId of new Set((event.citations ?? []).map(c => c.document_id))) {
              fetchSourceDownloadUrl(docId)
            }
            if (isNewSession && event.convId) {
              setSessionConvId(event.convId)
            }
          }
          if (!aiMsgAdded) aiMsgAdded = true
          // Keep the sidebar's cached conversation list (titles + saved
          // `messages`) in sync even if the user navigated away — so
          // reopening this conversation later shows the new answer.
          window.dispatchEvent(new CustomEvent('refresh-chat-history'))
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) processLine(line)
      }

      // Flush any complete event left in the buffer after the stream ends
      // (e.g. the final "done" event with no trailing newline).
      if (buf.startsWith('data: ')) processLine(buf)

      // Stream ended without a [done] event (e.g. connection cut short) —
      // finalize whatever text arrived so the message isn't stuck in a
      // permanent "streaming" state and silently dropped on next refresh.
      if (aiMsgAdded && !receivedDone && streamGuardRef.current === myGuard) {
        setMessages(prev => [
          ...prev.slice(0, -1),
          { role: 'ai', text: streamText, streaming: false },
        ])
      }
    } catch (e) {
      // The "done" event already delivered and finalized the real answer —
      // any error past that point (e.g. the connection closing after the
      // server has nothing left to send) is harmless stream-teardown noise,
      // not an answer failure. Appending the generic fallback message here
      // would show it directly after a perfectly good, complete answer.
      if (streamGuardRef.current === myGuard && !receivedDone) {
        // Show a rate-limit notice verbatim (it tells the user what to do);
        // fall back to a generic message for anything else.
        const text = e instanceof Error && /rate limit/i.test(e.message)
          ? e.message
          : "I'm sorry, something didn't go quite right. Please try again and I'll do my best to help."
        setMessages(prev => [...prev, { role: 'ai', text }])
      }
    } finally {
      if (streamGuardRef.current === myGuard) setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border border-gray-200 bg-white font-editorial-sans">

      {/* Messages — min-h-0 fixes flex overflow on iOS Safari */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-paper" style={{ WebkitOverflowScrolling: 'touch' }}>
        {messages.length === 0 ? (
          <WelcomeScreen greeting={greeting} firstName={firstName} tenantName={tenantName} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onCiteClick={setActiveSource} />
            ))}
            {/* Show typing dots immediately, then the fuller shimmer skeleton —
                only before the first token arrives (last msg is still from user) */}
            {loading && messages[messages.length - 1]?.role === 'user' && (
              showThinkingSkeleton ? <ThinkingSkeleton tenantName={tenantName} /> : <TypingIndicator />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Source viewer — slides in when a citation is clicked */}
      <SourceViewer citation={activeSource} onClose={() => setActiveSource(null)} />

      {/* Input bar */}
      <div className="shrink-0 border-t border-gray-200 bg-white/95 p-4 backdrop-blur-sm">
        <form onSubmit={e => { e.preventDefault(); submit(input) }} className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 border border-gray-300 bg-white px-3 py-3 transition-all focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              disabled={uploading} title="Attach a document"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-gray-400 transition hover:bg-gray-100 hover:text-brand disabled:opacity-40">
              {uploading
                ? <Sparkles className="h-4 w-4 animate-pulse text-brand" />
                : <Paperclip className="h-4 w-4" />}
            </button>
            <textarea
              ref={textareaRef} rows={1} value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) } }}
              placeholder={`Ask anything about your ${tenantName} documents…`}
              className="flex-1 resize-none bg-transparent text-base text-gray-900 placeholder-gray-400 focus:outline-none sm:text-sm"
              style={{ minHeight: '24px', maxHeight: '120px', fontSize: '16px' }}
            />
            <button type="submit" disabled={!input.trim() || loading || uploading}
              className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand text-white transition hover:bg-brand-dark disabled:opacity-30">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
