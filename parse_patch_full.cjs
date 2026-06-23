const fs = require('fs');
const transcript = fs.readFileSync('/Users/juliolopez/.gemini/antigravity-ide/brain/86513420-7a2c-4b20-82f9-285f66258dc9/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = transcript.split('\n');
for (const line of lines) {
  if (!line) continue;
  const obj = JSON.parse(line);
  if (obj.content && obj.content.includes("create this ai asiistance : diff --git")) {
    const text = obj.content;
    const startIndex = text.indexOf("diff --git");
    const patch = text.slice(startIndex);
    fs.writeFileSync('ai_assistant_full.patch', patch);
    console.log("Wrote ai_assistant_full.patch, length: " + patch.length);
    process.exit(0);
  }
}
