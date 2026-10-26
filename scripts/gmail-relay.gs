/**
 * Gmail relay for the therapy board app.
 * Paste into script.google.com, set SECRET, then Deploy -> New deployment -> Web app
 * (Execute as: Me, Who has access: Anyone). Put the URL in Render as GMAIL_RELAY_URL
 * and the same SECRET as GMAIL_RELAY_SECRET.
 */
const SECRET = "PASTE-A-LONG-RANDOM-STRING-HERE";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return json({ ok: false, error: "unauthorized" });
    if (!data.to || !data.to.length) return json({ ok: false, error: "no recipients" });

    GmailApp.sendEmail(data.to.join(","), data.subject || "(no subject)", data.text || "", {
      htmlBody: data.html || undefined,
      name: "PAM Therapy Board",
    });
    return json({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor to grant Gmail permission and send yourself a test. */
function testSend() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), "Relay test", "It works!");
}
