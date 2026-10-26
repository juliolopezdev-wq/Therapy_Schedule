# Therapy_Schedule

Stored messages use AES-256-GCM encryption for board titles, board bodies, and direct
message bodies. The server decrypts them for authorized readers; this is not end-to-end
encryption. IDs, participants, timestamps, channels, and other metadata remain readable.
Use HTTPS in production to protect messages in transit.

Before enabling messaging in an existing deployment:

1. Stop app instances that can write messages.
2. Set `MESSAGE_ENCRYPTION_KEY` to a randomly generated, base64-encoded 32-byte key
   (see `.env.example`). Store it as a server secret, separately from the database,
   and keep a secure recovery copy. All instances must use the same key.
3. Run `npm run messages:encrypt` against the intended database. This encrypts existing
   posts (including archived ones) and direct messages in a transaction. It can be rerun;
   already encrypted values are authenticated and left unchanged.
4. Set `MESSAGE_ENCRYPTION_ENABLED=true` on every instance and start the updated app.
   Reads reject plaintext or damaged ciphertext; writes fail
   if the key is absent or invalid. No plaintext fallback is provided.

For a coordinated rollout only, `MESSAGE_ENCRYPTION_ENABLED=false` explicitly disables
encryption of new writes and allows legacy plaintext reads. Do not leave this override
in place after migration. Without this override, encryption is required by default.
For a rolling deployment, set `MESSAGE_ENCRYPTION_ENABLED=true` and temporarily set
`MESSAGE_ENCRYPTION_ALLOW_LEGACY_READS=true` on all updated instances. New writes are
encrypted while existing plaintext remains readable. Once all older instances have
stopped, run the migration and set `MESSAGE_ENCRYPTION_ALLOW_LEGACY_READS=false`.
The migration also installs database triggers that reject plaintext message writes,
so an older app instance cannot reintroduce unencrypted messages.

Do not replace or lose the key: existing messages would become unreadable. Key rotation
requires decrypting with the old key and re-encrypting with the new key; it is not automatic.
Historical database backups may still contain plaintext and need separate retention and
access controls. Encryption does not change who can view messages in the application.
