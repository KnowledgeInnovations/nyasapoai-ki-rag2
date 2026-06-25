const fs = require('fs');
const cookie = fs.readFileSync('test-session-cookie.txt', 'utf8').trim();
const query = process.argv[2];
const agentic = process.argv[3] === 'agentic';

(async () => {
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, newSession: true, agentic }),
  });
  console.log('STATUS:', res.status);
  const text = await res.text();
  const lines = text.split('\n').filter(l => l.startsWith('data: '));
  const last = JSON.parse(lines[lines.length - 1].slice(6));
  console.log('ANSWER:', last.answer);
  console.log('CONFIDENCE:', last.confidence_score, last.confidence_level);
  console.log('RISKS:', last.risks);
  console.log('CITATIONS:', (last.citations ?? []).length, last.citations?.map(c => c.document_title));
  console.log('CONV ID:', last.convId, 'TITLE:', last.title);
})();
