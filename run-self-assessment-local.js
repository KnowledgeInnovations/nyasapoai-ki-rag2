const fs = require('fs');
const cookie = fs.readFileSync('test-session-cookie.txt', 'utf8').trim();

(async () => {
  const res = await fetch('http://localhost:3000/api/self-assessment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  });
  console.log('STATUS:', res.status);
  if (!res.body) { console.log(await res.text()); return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.stage === 'result') {
        console.log(ev.id, '| passed:', ev.passed, '| docIds:', ev.documentIds);
      } else if (ev.stage === 'complete') {
        console.log('COMPLETE:', ev);
      }
    }
  }
})();
