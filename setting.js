module.exports = {
  // ── BOT ──────────────────────────────────────────────
  botName: 'Eva',
  prefix: '.',
  ownerNumber: ['628xxxxxxxxxx'], // ganti nomor kamu
  botThumb: 'https://raw.githubusercontent.com/Danuy-Coder/Eva-AIv2/refs/heads/main/media/IMG-20260524-WA0041.jpg', 
  // ── AI API ───────────────────────────────────────────
  aiApiUrl: 'https://api.betabotz.eu.org/api/search/openai-logic',
  aiApiKey: 'Btz-Cynix',
  aiLogic:  'Kamu adalah Eva, asisten AI yang ramah, cerdas, dan helpful untuk edukasi. Jawab dalam bahasa Indonesia secara natural dan mudah dipahami.',

  // ── PROXY SERVER ─────────────────────────────────────
  proxyPort: 3001,
  // Token rahasia buat akses endpoint /ai dari web
  // Ganti dengan string random yang susah ditebak!
  proxyToken: '230623',

  // ── PESAN ────────────────────────────────────────────
  msg: {
    onlyGroup:    '❌ Hanya bisa dipakai di grup.',
    onlyAdmin:    '❌ Hanya untuk admin grup.',
    onlyOwner:    '❌ Hanya untuk owner bot.',
    onlyBotAdmin: '❌ Jadikan bot sebagai admin grup dulu.',
    error:        '❌ Terjadi kesalahan, coba lagi.',
  }
}
