const fs = require('fs');
const cookie = fs.readFileSync('test-session-cookie.txt', 'utf8').trim();
const query = process.argv[2];

(async () => {
  const res = await fetch('https://nyansaai.com/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, newSession: true }),
  });
  const text = await res.text();
  const lines = text.split('\n').filter(l => l.startsWith('data: '));
  const last = JSON.parse(lines[lines.length - 1].slice(6));
  console.log('QUESTION:', query);
  console.log('ANSWER:', last.answer?.slice(0, 600));
  console.log('CONFIDENCE:', last.confidence_score, last.confidence_level);
  console.log('CITATIONS:', last.citations?.length, last.citations?.map(c => `${c.document_title} p.${c.page_number}`).slice(0, 8));
  console.log('---');
})();
