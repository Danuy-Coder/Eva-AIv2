// ── SETTING BOT EVA ──────────────────────────────────────
module.exports = {
  // Info Bot
  botName: 'Eva',
  botNumber: '', // nomor bot kamu (opsional, untuk self-reply check)

  // Prefix command
  prefix: '.',

  // Owner
  ownerNumber: ['628xxxxxxxxxx'], // ganti dengan nomor owner (format: 628xxx)

  // API
  aiApiUrl: 'https://api.betabotz.eu.org/api/search/openai-logic',
  aiApiKey: 'Btz-Cynix',
  aiLogic: 'Kamu adalah Eva, asisten AI yang ramah, cerdas, dan helpful. Kamu berbicara dalam bahasa Indonesia secara natural.',

  // Pesan default
  msg: {
    onlyGroup:    '❌ Perintah ini hanya bisa dipakai di grup.',
    onlyAdmin:    '❌ Perintah ini hanya untuk admin grup.',
    onlyOwner:    '❌ Hanya owner bot yang bisa menggunakan ini.',
    onlyBotAdmin: '❌ Jadikan bot sebagai admin grup dulu.',
    wait:         '⏳ Mohon tunggu...',
    error:        '❌ Terjadi kesalahan, coba lagi.',
  }
}
