const fs = require('fs');
const transcript = fs.readFileSync('/Users/juliolopez/.gemini/antigravity-ide/brain/86513420-7a2c-4b20-82f9-285f66258dc9/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = transcript.split('\n');
for (const line of lines) {
  if (!line) continue;
  const obj = JSON.parse(line);
  if (obj.content && obj.content.includes("create this ai asiistance : diff --git")) {
    let text = obj.content;
    const startIndex = text.indexOf("diff --git");
    text = text.slice(startIndex);
    
    // Remove all <truncated ...> markers
    text = text.replace(/<truncated \d+ bytes>/g, '');
    
    fs.writeFileSync('ai_assistant_clean.patch', text);
    console.log("Wrote ai_assistant_clean.patch, length: " + text.length);
    process.exit(0);
  }
}
