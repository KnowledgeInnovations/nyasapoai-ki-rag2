/**
 * Phase 3 second-pass AI verifier. A small, deterministic-temperature
 * gpt-4o-mini call that checks the model's own answer against the
 * VALIDATED FACTS block and the retrieved document excerpts, looking for
 * numeric or factual claims that contradict the evidence or aren't
 * supported by it. Complements the regex-based verifyAnswer() in
 * ragAnalysis.ts, which only checks that numbers literally appear
 * somewhere in the chunks (not whether they're attributed correctly).
 */

const OPENAI_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
}

export interface AnswerVerificationResult {
  issues: string[]
}

interface VerifyAnswerWithAIArgs {
  query: string
  answer: string
  factsBlock: string
  context: string
  signal?: AbortSignal
}

const SYSTEM_PROMPT = `You are a fact-checker. You will be given a QUESTION, an ANSWER produced by another assistant, a VALIDATED FACTS table, and DOCUMENT EXCERPTS.

Check every numeric or factual claim in the ANSWER:
- If it contradicts a value in VALIDATED FACTS, that's an issue.
- If it asserts something not supported by VALIDATED FACTS or the DOCUMENT EXCERPTS, that's an issue.
- If the ANSWER's premise itself is false relative to the evidence (e.g. claims one figure exceeds another when it doesn't), that's an issue.

Currency/unit notation is NOT an issue. "GHS", "GH¢", "¢", "cedis", "GH₵" all refer to the Ghanaian cedi — if the ANSWER writes "GHS 110 million" and the source says "110 million" (or vice versa), that is the SAME figure with an added/omitted currency label, not a discrepancy. Do not flag differences that are purely about whether a currency symbol/code is present, spelled out, or abbreviated.

Numeric formatting is NOT an issue. Two numbers that are mathematically equal — e.g. "27,000" vs "27,000.00", "1.2 billion" vs "1,200 million", "5,100,000,000" vs "5.1bn" — are the SAME value. NEVER flag a difference in trailing zeros, decimal places, thousands separators, or unit-scale notation (million/billion/etc.) when the underlying numeric value is identical. Only flag a number if its actual magnitude is different from the source.

Before flagging anything, find the EXACT sentence in the ANSWER containing the claim and re-read it carefully — many candidate issues turn out not to actually be present in the ANSWER text (e.g. the ANSWER already states the correct total/percentage). Only flag a claim if you can quote the specific wrong number or statement that literally appears in the ANSWER. If you are not at least 80% confident an issue is real, do not include it.

Respond ONLY with JSON: {"issues": ["short description of issue, including the exact wrong figure quoted from the ANSWER", ...]}. If there are no issues, return {"issues": []}. Keep each issue under 20 words. Do not invent issues — if the ANSWER is well-supported, return an empty array.`

export async function verifyAnswerWithAI(
  { query, answer, factsBlock, context, signal }: VerifyAnswerWithAIArgs,
): Promise<AnswerVerificationResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `QUESTION:\n${query}\n\nVALIDATED FACTS:${factsBlock || ' (none)'}\n\nDOCUMENT EXCERPTS:\n${context}\n\nANSWER:\n${answer}`,
          },
        ],
      }),
      signal,
    })

    if (!res.ok) return { issues: [] }

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return { issues: [] }

    const parsed = JSON.parse(raw)
    const issues = Array.isArray(parsed.issues) ? parsed.issues.filter((i: unknown) => typeof i === 'string') : []
    return { issues }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    console.error('[RAG] AI verifier failed:', e)
    return { issues: [] }
  }
}
