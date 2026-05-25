const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  downloadMediaMessage
} = require('@whiskeysockets/baileys')
const pino    = require('pino')
const qrcode  = require('qrcode-terminal')
const axios   = require('axios')
const sharp   = require('sharp')
const express = require('express')
const cfg     = require('./setting')

// ── DATA SEMENTARA ────────────────────────────────────────
const warnData     = {}
const antilinkData = {}
const linkRegex    = /(https?:\/\/|wa\.me|whatsapp\.com\/|bit\.ly|t\.me\/|chat\.whatsapp\.com)/i

// ── HELPER ───────────────────────────────────────────────
function getCmd(text, prefix) {
  if (!text || !text.startsWith(prefix)) return { cmd: null, args: [] }
  const parts = text.slice(prefix.length).trim().split(/\s+/)
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) }
}

function getMenu() {
  const p = cfg.prefix
  return `╭──── ${cfg.botName} ────
│
│ 🤖 *AI*
│ ${p}ai <tanya>      — chat sama Eva
│
│ 🖼️ *Media*
│ ${p}pap <keyword>   — foto Pinterest
│ ${p}anime <keyword> — foto anime Pinterest
│
│ 🛡️ *Manajemen Grup*
│ ${p}tagall          — tag semua member
│ ${p}hidetag <teks>  — tag tersembunyi
│ ${p}open            — buka grup
│ ${p}close           — tutup grup
│ ${p}kick @user      — keluarkan member
│ ${p}promote @user   — jadikan admin
│ ${p}demote @user    — turunkan admin
│ ${p}warn @user      — beri peringatan
│ ${p}antilink on/off
│
│ 🎨 *Lainnya*
│ ${p}sticker / ${p}s  — gambar → stiker
│ ${p}getapi          — info akses proxy API
│ ${p}menu            — tampilkan menu
│
╰────────────────────`
}

// ════════════════════════════════════════════════════════
// ── PROXY API SERVER ─────────────────────────────────────
// ════════════════════════════════════════════════════════
function startProxyServer() {
  const app = express()
  app.use(express.json())

  // ── CORS ─────────────────────────────────────────────
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  // ── AUTH ─────────────────────────────────────────────
  function authCheck(req, res, next) {
    const token = req.headers['x-api-key'] || req.query.token
    if (!token || token !== cfg.proxyToken) {
      return res.status(401).json({ status: false, message: 'Unauthorized.' })
    }
    next()
  }

  // ── GET /ai ──────────────────────────────────────────
  app.get('/ai', authCheck, async (req, res) => {
    const text  = req.query.text?.trim()
    const logic = req.query.logic || cfg.aiLogic
    if (!text) return res.status(400).json({ status: false, message: 'Parameter "text" wajib diisi.' })
    try {
      const response = await axios.get(cfg.aiApiUrl, {
        params: { text, logic, apikey: cfg.aiApiKey },
        timeout: 15000
      })
      const result = response.data?.result || response.data?.answer || response.data?.message
      if (!result) throw new Error('Respons API kosong')
      res.json({ status: true, result })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── POST /ai ─────────────────────────────────────────
  app.post('/ai', authCheck, async (req, res) => {
    const text  = req.body?.text?.trim()
    const logic = req.body?.logic || cfg.aiLogic
    if (!text) return res.status(400).json({ status: false, message: 'Field "text" wajib diisi.' })
    try {
      const response = await axios.get(cfg.aiApiUrl, {
        params: { text, logic, apikey: cfg.aiApiKey },
        timeout: 15000
      })
      const result = response.data?.result || response.data?.answer || response.data?.message
      if (!result) throw new Error('Respons API kosong')
      res.json({ status: true, result })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── GET /pinterest ───────────────────────────────────
  app.get('/pinterest', authCheck, async (req, res) => {
    const text = req.query.text?.trim()
    if (!text) return res.status(400).json({ status: false, message: 'Parameter "text" wajib diisi.' })
    try {
      const response = await axios.get('https://api.betabotz.eu.org/api/search/pinterest', {
        params: { text1: text, apikey: cfg.aiApiKey },
        timeout: 15000
      })
      res.json({ status: true, result: response.data })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── GET /music ───────────────────────────────────────
  app.get('/music', authCheck, async (req, res) => {
    const query = req.query.query?.trim()
    if (!query) return res.status(400).json({ status: false, message: 'Parameter "query" wajib diisi.' })
    try {
      const response = await axios.get('https://api.betabotz.eu.org/api/search/yts', {
        params: { query, apikey: cfg.aiApiKey },
        timeout: 15000
      })
      res.json({ status: true, result: response.data })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── GET /ytmp3 ───────────────────────────────────────────
app.get('/ytmp3', authCheck, async (req, res) => {
  const url = req.query.url?.trim()
  if (!url) return res.status(400).json({ status: false, message: 'Parameter "url" wajib diisi.' })
  try {
    const response = await axios.get('https://api.betabotz.eu.org/api/download/ytmp3', {
      params: { url, apikey: cfg.aiApiKey },
      timeout: 30000
    })
    res.json({ status: true, result: response.data })
  } catch (e) {
    res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
  }
})

  // ── GET / (status) ───────────────────────────────────
  app.get('/', (req, res) => {
    res.json({
      status: true,
      bot: cfg.botName,
      message: 'Proxy API aktif.',
      endpoints: {
        'GET /ai?text=...&token=...':          'Chat AI',
        'GET /pinterest?text=...&token=...':   'Foto Pinterest',
        'GET /music?query=...&token=...':      'Search musik YouTube'
      }
    })
  })

  app.listen(cfg.proxyPort, () => {
    console.log(`\n🌐 Proxy aktif di port ${cfg.proxyPort}`)
    console.log(`   /ai        → Chat AI`)
    console.log(`   /pinterest → Foto Pinterest`)
    console.log(`   /music     → Search YouTube\n`)
  })
}

// ════════════════════════════════════════════════════════
// ── WHATSAPP BOT ─────────────────────────────────────────
// ════════════════════════════════════════════════════════
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Eva Bot', 'Chrome', '1.0.0'],
    getMessage: async () => ({ conversation: 'hello' })
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n[QR] Scan QR berikut:\n')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('[BOT] Koneksi terputus.', shouldReconnect ? 'Reconnecting...' : 'Logged out.')
      if (shouldReconnect) startBot()
    } else if (connection === 'open') {
      console.log(`✅ ${cfg.botName} terhubung!\n`)
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    for (const participant of participants) {
      const num = participant.replace('@s.whatsapp.net', '')
      if (action === 'add') {
        await sock.sendMessage(id, { text: `👋 Selamat datang @${num}!\nSilakan baca deskripsi grup ya.`, mentions: [participant] })
      } else if (action === 'remove') {
        await sock.sendMessage(id, { text: `👋 Sampai jumpa @${num}!`, mentions: [participant] })
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue

      const from      = m.key.remoteJid
      const isGroup   = from.endsWith('@g.us')
      const sender    = isGroup ? m.key.participant : from
      const senderNum = sender?.replace(/[^0-9]/g, '')
      const isOwner   = cfg.ownerNumber.map(n => n.replace(/[^0-9]/g, '')).includes(senderNum)

      const body =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption || ''

      const { cmd, args } = getCmd(body, cfg.prefix)
      const reply = (text) => sock.sendMessage(from, { text }, { quoted: m })
      const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: m.key } })

      let groupMeta = null, isAdmin = false, isBotAdmin = false
      if (isGroup) {
        try {
          groupMeta    = await sock.groupMetadata(from)
          const admins = groupMeta.participants.filter(p => p.admin).map(p => p.id)
          isAdmin      = admins.includes(sender)
          isBotAdmin   = admins.includes(jidNormalizedUser(sock.user.id))
        } catch {}
      }

      const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
      const target    = mentioned[0] || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null)

      // ── AUTO ANTILINK ─────────────────────────────────
      if (isGroup && !isAdmin && !isOwner && antilinkData[from] && linkRegex.test(body)) {
        if (isBotAdmin) {
          await sock.sendMessage(from, { delete: m.key })
          await sock.groupParticipantsUpdate(from, [sender], 'remove')
          await sock.sendMessage(from, { text: '🚫 Link tidak diizinkan. Member telah dikeluarkan.' })
        } else {
          await reply('🚫 Link tidak diizinkan di grup ini!')
        }
        continue
      }

      // ── AUTO AI (DM / mention / reply bot) ───────────
      const botJid      = sock.user?.id
      const isMentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botJid)
      const isReplyBot  = m.message?.extendedTextMessage?.contextInfo?.participant === botJid

      if (!cmd && body.trim() && (isMentioned || isReplyBot || !isGroup)) {
        await react('🤔')
        try {
          const res = await axios.get(cfg.aiApiUrl, {
            params: { text: body, logic: cfg.aiLogic, apikey: cfg.aiApiKey },
            timeout: 15000
          })
          const result = res.data?.result || res.data?.answer || res.data?.message
          if (!result) throw new Error('empty')
          await react('✅')
          await reply(`🤖 *${cfg.botName}:*\n${result}`)
        } catch {
          await react('❌')
          await reply(cfg.msg.error)
        }
        continue
      }

      if (!cmd) continue

      // ── SWITCH CASE ───────────────────────────────────
      switch (cmd) {

        case 'menu':
        case 'help':
          await reply(getMenu())
          break

        // ── AI ──
        case 'ai':
        case 'eva':
        case 'ask': {
          const text = args.join(' ').trim()
          if (!text) { await reply(`Tulis pertanyaanmu!\nContoh: ${cfg.prefix}ai siapa einstein?`); break }
          await react('🤔')
          try {
            const res = await axios.get(cfg.aiApiUrl, {
              params: { text, logic: cfg.aiLogic, apikey: cfg.aiApiKey },
              timeout: 15000
            })
            const result = res.data?.result || res.data?.answer || res.data?.message
            if (!result) throw new Error('empty')
            await react('✅')
            await reply(`🤖 *${cfg.botName}:*\n${result}`)
          } catch {
            await react('❌')
            await reply(cfg.msg.error)
          }
          break
        }

        // ── PAP (Pinterest) ──
        case 'pap':
        case 'anime': {
          const keyword = args.join(' ').trim()
          if (!keyword) { await reply(`Tulis keyword!\nContoh: ${cfg.prefix}pap sunset aesthetic`); break }
          await react('🔍')
          try {
            const res  = await axios.get('https://api.betabotz.eu.org/api/search/pinterest', {
              params: { text1: keyword, apikey: cfg.aiApiKey },
              timeout: 15000
            })
            const data   = res.data
            const images = Array.isArray(data?.result) ? data.result
              : Array.isArray(data?.data) ? data.data
              : Array.isArray(data) ? data : null

            if (!images || images.length === 0) {
              await react('❌')
              await reply('Foto tidak ditemukan, coba keyword lain.')
              break
            }

            const urls = images.slice(0, 10)
            await react('✅')
            await reply(`🖼️ *${keyword}* — ${urls.length} foto`)

            for (const url of urls) {
              const imgUrl = typeof url === 'string' ? url : url?.url || url?.image || url?.link
              if (!imgUrl) continue
              try {
                const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 10000 })
                await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: '' }, { quoted: m })
                await new Promise(r => setTimeout(r, 600))
              } catch {}
            }
          } catch {
            await react('❌')
            await reply(cfg.msg.error)
          }
          break
        }

        // ── STICKER ──
        case 'sticker':
        case 's': {
          const isImg = m.message?.imageMessage || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage
          if (!isImg) { await reply('📸 Kirim/reply gambar dengan caption .s'); break }
          await react('⏳')
          try {
            const buf  = await downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
            const webp = await sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer()
            await sock.sendMessage(from, { sticker: webp, mimetype: 'image/webp' }, { quoted: m })
            await react('✅')
          } catch {
            await react('❌')
            await reply(cfg.msg.error)
          }
          break
        }

        // ── OPEN / CLOSE ──
        case 'open':
        case 'close': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          await sock.groupSettingUpdate(from, cmd === 'open' ? 'not_announcement' : 'announcement')
          await reply(cmd === 'open' ? '🔓 Grup dibuka.' : '🔒 Grup ditutup.')
          break
        }

        // ── TAGALL ──
        case 'tagall':
        case 'everyone': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          const text    = args.join(' ') || '📢 Perhatian!'
          const members = groupMeta.participants.map(p => p.id)
          for (let i = 0; i < members.length; i += 50) {
            const chunk = members.slice(i, i + 50)
            const tags  = chunk.map(id => `@${id.replace('@s.whatsapp.net', '')}`).join(' ')
            await sock.sendMessage(from, { text: i === 0 ? `${text}\n\n${tags}` : tags, mentions: chunk })
          }
          break
        }

        // ── HIDETAG ──
        case 'hidetag':
        case 'ht': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          const members = groupMeta.participants.map(p => p.id)
          await sock.sendMessage(from, { text: args.join(' ') || '📢 Pengumuman', mentions: members })
          break
        }

        // ── KICK ──
        case 'kick': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          if (!target) { await reply('Tag member yang mau di-kick.'); break }
          await sock.groupParticipantsUpdate(from, [target], 'remove')
          await reply('✅ Member berhasil dikeluarkan.')
          break
        }

        // ── PROMOTE ──
        case 'promote': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          if (!target) { await reply('Tag member yang mau dipromote.'); break }
          await sock.groupParticipantsUpdate(from, [target], 'promote')
          await reply('⬆️ Member berhasil dijadikan admin.')
          break
        }

        // ── DEMOTE ──
        case 'demote': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          if (!target) { await reply('Tag admin yang mau di-demote.'); break }
          await sock.groupParticipantsUpdate(from, [target], 'demote')
          await reply('⬇️ Admin berhasil diturunkan.')
          break
        }

        // ── WARN ──
        case 'warn': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!target) { await reply('Tag member yang mau diwarn.'); break }
          if (!warnData[from]) warnData[from] = {}
          warnData[from][target] = (warnData[from][target] || 0) + 1
          const count = warnData[from][target]
          const num   = target.replace('@s.whatsapp.net', '')
          if (count >= 3) {
            if (isBotAdmin) {
              await sock.groupParticipantsUpdate(from, [target], 'remove')
              delete warnData[from][target]
              await sock.sendMessage(from, { text: `⚠️ @${num} sudah 3x warn dan telah dikeluarkan.`, mentions: [target] })
            } else {
              await reply(`⚠️ @${num} sudah 3x warn! (Bot bukan admin, tidak bisa kick)`)
            }
            break
          }
          await sock.sendMessage(from, { text: `⚠️ Peringatan ${count}/3 untuk @${num}.`, mentions: [target] })
          break
        }

        // ── ANTILINK ──
        case 'antilink': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          const mode = args[0]?.toLowerCase()
          if (!['on', 'off'].includes(mode)) { await reply('Gunakan: .antilink on / .antilink off'); break }
          antilinkData[from] = mode === 'on'
          await reply(`🛡️ Antilink *${mode === 'on' ? 'diaktifkan' : 'dimatikan'}*.`)
          break
        }

        // ── GETAPI ──
        case 'getapi': {
          const info = `╭──── 🔌 *Eva API Access* ────
│
│ 📡 *Base URL*
│ https://cynix.tokopanel.my.id
│
│ 🔑 *Token*
│ ${cfg.proxyToken}
│
│ 🤖 *AI Chat*
│ GET /ai?text=...&token=...
│
│ 🖼️ *Pinterest*
│ GET /pinterest?text=...&token=...
│
│ 🎵 *Music Search*
│ GET /music?query=...&token=...
│
│ ✅ *Response*
│ { "status": true, "result": ... }
│
│ ⚠️ Jangan share token ini!
╰──────────────────────────`
          await reply(info)
          break
        }

        // ── TAMBAH FITUR BARU DI SINI ──
        // case 'namafitur': {
        //   await reply('fitur baru!')
        //   break
        // }

        default:
          break
      }
    }
  })
}

// ── START ─────────────────────────────────────────────────
startProxyServer()
startBot()
