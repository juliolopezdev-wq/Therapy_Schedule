const fs = require('fs');
const transcript = fs.readFileSync('/Users/juliolopez/.gemini/antigravity-ide/brain/86513420-7a2c-4b20-82f9-285f66258dc9/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = transcript.split('\n');
for (const line of lines) {
  if (!line) continue;
  const obj = JSON.parse(line);
  if (obj.content && obj.content.includes("create this ai asiistance : diff --git")) {
    const text = obj.content;
    const startIndex = text.indexOf("diff --git");
    const endIndex = text.indexOf("<truncated ");
    const patch = text.slice(startIndex, endIndex !== -1 ? endIndex : undefined);
    fs.writeFileSync('ai_assistant.patch', patch);
    console.log("Wrote ai_assistant.patch");
    process.exit(0);
  }
}
