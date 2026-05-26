const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, jidNormalizedUser, downloadMediaMessage } = require('@whiskeysockets/baileys')
const pino = require('pino')
const qrcode = require('qrcode-terminal')
const axios = require('axios')
const sharp = require('sharp')
const express = require('express')
const cfg = require('./setting')

const store = null

// ── DATA SEMENTARA ────────────────────────────────────────
const warnData = {}
const antilinkData = {}
const linkRegex = /(https?:\/\/|wa\.me|whatsapp\.com\/|bit\.ly|t\.me\/|chat\.whatsapp\.com)/i

// ── INVIDIOUS INSTANCES ───────────────────────────────────
const INV = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.drgnz.club',
  'https://iv.datura.network'
]

async function invReq(path, params = {}) {
  for (const base of INV) {
    try {
      const r = await axios.get(`${base}/api/v1${path}`, { params, timeout: 8000 })
      if (r.data) return r.data
    } catch { continue }
  }
  throw new Error('Semua Invidious instance gagal')
}

const fmtSec = s => !s ? '' : `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

// ── HELPER ───────────────────────────────────────────────
function getCmd(text, prefix) {
  if (!text || !text.startsWith(prefix)) return { cmd: null, args: [] }
  const parts = text.slice(prefix.length).trim().split(/\s+/)
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) }
}

function getTime() {
  const now = new Date()
  const h = now.getHours()
  const m = now.getMinutes()
  return { h, m, str: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` }
}

// ── SEND MENU (dengan thumbnail) ─────────────────────────
async function sendMenu(sock, from, m) {
  const p = cfg.prefix
  const caption =
`┌─「 *${cfg.botName}* 」─────────
│
├─「 🤖 *AI & Chat* 」
│  ◦ ${p}ai _<pertanyaan>_
│
├─「 🎵 *Musik* 」
│  ◦ ${p}musik _<judul lagu>_
│  ◦ ${p}ytsearch _<kata kunci>_
│
├─「 🖼️ *Media* 」
│  ◦ ${p}pap _<keyword>_
│  ◦ ${p}anime _<keyword>_
│
├─「 🛡️ *Grup* 」
│  ◦ ${p}tagall  •  ${p}hidetag
│  ◦ ${p}open  •  ${p}close
│  ◦ ${p}kick  •  ${p}promote  •  ${p}demote
│  ◦ ${p}warn  •  ${p}antilink on|off
│
├─「 🎨 *Tools* 」
│  ◦ ${p}sticker  /  ${p}s
│  ◦ ${p}getapi
│
└──────────────────────
> _${cfg.botName} · siap melayani 24/7_ ✨`

  try {
    const imgResp = await axios.get(cfg.botThumb || 'https://files.catbox.moe/hxqfag.jpg', {
      responseType: 'arraybuffer', timeout: 8000
    })
    await sock.sendMessage(from, {
      image: Buffer.from(imgResp.data),
      caption,
      mimetype: 'image/jpeg'
    }, { quoted: m })
  } catch {
    // fallback teks kalau gambar gagal
    await sock.sendMessage(from, { text: caption }, { quoted: m })
  }
}

// ════════════════════════════════════════════════════════
// ── PROXY API SERVER ─────────────────────────────────────
// ════════════════════════════════════════════════════════
function startProxyServer() {
  const app = express()
  app.use(express.json())

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  // AUTH
  function authCheck(req, res, next) {
    const token = req.headers['x-api-key'] || req.query.token
    if (!token || token !== cfg.proxyToken) {
      return res.status(401).json({ status: false, message: 'Unauthorized.' })
    }
    next()
  }

  // GET /ai
  app.get('/ai', authCheck, async (req, res) => {
    const text  = req.query.text?.trim()
    const logic = req.query.logic || cfg.aiLogic
    if (!text) return res.status(400).json({ status: false, message: 'Parameter "text" wajib diisi.' })
    try {
      const response = await axios.get(cfg.aiApiUrl, {
        params: { text, logic, apikey: cfg.aiApiKey }, timeout: 15000
      })
      const result = response.data?.result || response.data?.answer || response.data?.message
      if (!result) throw new Error('Respons API kosong')
      res.json({ status: true, result })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // POST /ai
  app.post('/ai', authCheck, async (req, res) => {
    const text  = req.body?.text?.trim()
    const logic = req.body?.logic || cfg.aiLogic
    if (!text) return res.status(400).json({ status: false, message: 'Field "text" wajib diisi.' })
    try {
      const response = await axios.get(cfg.aiApiUrl, {
        params: { text, logic, apikey: cfg.aiApiKey }, timeout: 15000
      })
      const result = response.data?.result || response.data?.answer || response.data?.message
      if (!result) throw new Error('Respons API kosong')
      res.json({ status: true, result })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // GET /pinterest
  app.get('/pinterest', authCheck, async (req, res) => {
    const text = req.query.text?.trim()
    if (!text) return res.status(400).json({ status: false, message: 'Parameter "text" wajib diisi.' })
    try {
      const response = await axios.get('https://api.betabotz.eu.org/api/search/pinterest', {
        params: { text1: text, apikey: cfg.aiApiKey }, timeout: 15000
      })
      res.json({ status: true, result: response.data })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // GET /music — Invidious (ganti betabotz yang 500)
  app.get('/music', authCheck, async (req, res) => {
    const query = req.query.query?.trim()
    if (!query) return res.status(400).json({ status: false, message: 'Parameter "query" wajib diisi.' })
    try {
      const results = await invReq('/search', {
        q: query, type: 'video',
        fields: 'videoId,title,author,lengthSeconds,videoThumbnails'
      })
      if (!Array.isArray(results) || results.length === 0)
        return res.json({ status: false, message: 'Tidak ditemukan.' })
      const formatted = results.slice(0, 8).map(v => ({
        title:     v.title,
        author:    v.author,
        duration:  fmtSec(v.lengthSeconds),
        seconds:   v.lengthSeconds,
        thumbnail: v.videoThumbnails?.find(t => t.quality === 'medium')?.url || v.videoThumbnails?.[0]?.url || '',
        url:       `https://www.youtube.com/watch?v=${v.videoId}`,
        videoId:   v.videoId
      }))
      res.json({ status: true, result: formatted })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // GET /ytmp3 — audio stream dari Invidious
  app.get('/ytmp3', authCheck, async (req, res) => {
    let videoId = req.query.videoid || req.query.videoId
    if (!videoId && req.query.url) {
      const match = req.query.url.match(/[?&]v=([^&]+)/) || req.query.url.match(/youtu\.be\/([^?&]+)/)
      if (match) videoId = match[1]
    }
    if (!videoId) return res.status(400).json({ status: false, message: 'Parameter "videoid" wajib diisi.' })
    try {
      const data = await invReq(`/videos/${videoId}`, {
        fields: 'title,author,lengthSeconds,videoThumbnails,adaptiveFormats,formatStreams'
      })
      const audioFmt = (data.adaptiveFormats || [])
        .filter(f => f.type?.startsWith('audio/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
      let streamUrl = audioFmt[0]?.url
      if (!streamUrl) {
        const ff = data.formatStreams || []
        streamUrl = ff[ff.length - 1]?.url
      }
      if (!streamUrl) throw new Error('Tidak ada stream tersedia')
      res.json({
        status: true,
        result: {
          result: { mp3: streamUrl },
          title:     data.title,
          author:    data.author,
          duration:  fmtSec(data.lengthSeconds),
          thumbnail: data.videoThumbnails?.find(t => t.quality === 'medium')?.url || data.videoThumbnails?.[0]?.url || ''
        }
      })
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // GET /
  app.get('/', (req, res) => {
    res.json({
      status: true, bot: cfg.botName, message: 'Proxy API aktif.',
      endpoints: {
        'GET /ai?text=...&token=...':        'Chat AI',
        'GET /music?query=...&token=...':    'Search lagu (Invidious)',
        'GET /ytmp3?videoid=...&token=...':  'Audio stream URL',
        'GET /pinterest?text=...&token=...': 'Foto Pinterest'
      }
    })
  })

  app.listen(cfg.proxyPort, () => {
    console.log(`\n🌐 Proxy API aktif di port ${cfg.proxyPort}`)
    console.log(`   https://cynix.tokopanel.my.id\n`)
  })
}

// ════════════════════════════════════════════════════════
// ── WHATSAPP BOT ─────────────────────────────────────────
// ════════════════════════════════════════════════════════
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Eva Bot', 'Chrome', '1.0.0'],
    getMessage: async key => ({ conversation: 'hello' })
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

  // ── WELCOME & LEAVE (pakai foto profil member) ────────
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    for (const participant of participants) {
      const num = participant.replace('@s.whatsapp.net', '')

      if (action === 'add') {
        const caption =
`╔══════════════════╗
║  👋  *SELAMAT DATANG!*  ║
╚══════════════════╝

Halo @${num}! 🎉
Senang kamu bergabung di sini~

📌 *Silakan baca deskripsi grup ya!*
Semoga betah & aktif 🙏

> _${cfg.botName}_`
        try {
          const ppUrl = await sock.profilePictureUrl(participant, 'image').catch(() => null)
          if (!ppUrl) throw new Error('no pp')
          const imgResp = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 6000 })
          await sock.sendMessage(id, {
            image: Buffer.from(imgResp.data),
            caption, mentions: [participant], mimetype: 'image/jpeg'
          })
        } catch {
          await sock.sendMessage(id, { text: caption, mentions: [participant] })
        }

      } else if (action === 'remove') {
        const caption =
`╔══════════════════╗
║   👋  *SAMPAI JUMPA!*   ║
╚══════════════════╝

@${num} telah meninggalkan grup.
Semoga sukses selalu~ 🙏

> _${cfg.botName}_`
        try {
          const ppUrl = await sock.profilePictureUrl(participant, 'image').catch(() => null)
          if (!ppUrl) throw new Error('no pp')
          const imgResp = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 6000 })
          await sock.sendMessage(id, {
            image: Buffer.from(imgResp.data),
            caption, mentions: [participant], mimetype: 'image/jpeg'
          })
        } catch {
          await sock.sendMessage(id, { text: caption, mentions: [participant] })
        }
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
          groupMeta  = await sock.groupMetadata(from)
          const admins = groupMeta.participants.filter(p => p.admin).map(p => p.id)
          isAdmin    = admins.includes(sender)
          isBotAdmin = admins.includes(jidNormalizedUser(sock.user.id))
        } catch {}
      }

      const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
      const target    = mentioned[0] || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null)

      // AUTO ANTILINK
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

      // AUTO AI (DM / mention / reply bot)
      const botJid      = sock.user?.id
      const isMentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botJid)
      const isReplyBot  = m.message?.extendedTextMessage?.contextInfo?.participant === botJid

      if (!cmd && body.trim() && (isMentioned || isReplyBot || !isGroup)) {
        await react('🤔')
        try {
          const res = await axios.get(cfg.aiApiUrl, {
            params: { text: body, logic: cfg.aiLogic, apikey: cfg.aiApiKey }, timeout: 15000
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

        // ── MENU ──
        case 'menu':
        case 'help':
          await sendMenu(sock, from, m)
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
              params: { text, logic: cfg.aiLogic, apikey: cfg.aiApiKey }, timeout: 15000
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

        // ── MUSIK — search + download + kirim audio ──
        case 'musik':
        case 'music':
        case 'lagu':
        case 'play': {
          const query = args.join(' ').trim()
          if (!query) { await reply(`🎵 Tulis judul lagu!\nContoh: ${cfg.prefix}musik photograph ed sheeran`); break }
          await react('🔍')
          try {
            // 1. Search
            const results = await invReq('/search', {
              q: query, type: 'video', fields: 'videoId,title,author,lengthSeconds'
            })
            if (!Array.isArray(results) || results.length === 0) {
              await react('❌'); await reply(`❌ Lagu *${query}* tidak ditemukan.`); break
            }
            const video = results[0]
            const { videoId, title, author } = video
            const durText = fmtSec(video.lengthSeconds)

            if (video.lengthSeconds > 600) {
              await react('❌'); await reply(`❌ Video terlalu panjang (${durText}). Cari yang lebih pendek.`); break
            }

            await react('⏳')

            // 2. Ambil stream + thumbnail
            const vData = await invReq(`/videos/${videoId}`, {
              fields: 'adaptiveFormats,formatStreams,videoThumbnails'
            })
            const thumbUrl = vData.videoThumbnails?.find(t => t.quality === 'medium')?.url
                          || vData.videoThumbnails?.find(t => t.quality === 'high')?.url
                          || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`

            // 3. Kirim info + thumbnail dulu
            try {
              const tResp = await axios.get(thumbUrl, { responseType: 'arraybuffer', timeout: 6000 })
              await sock.sendMessage(from, {
                image: Buffer.from(tResp.data),
                caption: `🎵 *${title}*\n👤 ${author}\n⏱ ${durText}\n\n⬇️ _Sedang mengunduh..._`,
                mimetype: 'image/jpeg'
              }, { quoted: m })
            } catch {
              await reply(`🎵 *${title}*\n👤 ${author} · ⏱ ${durText}\n\n⬇️ Sedang mengunduh...`)
            }

            // 4. Ambil audio stream URL
            const audioFmt = (vData.adaptiveFormats || [])
              .filter(f => f.type?.startsWith('audio/'))
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
            let streamUrl = audioFmt[0]?.url
            if (!streamUrl) {
              const ff = vData.formatStreams || []
              streamUrl = ff[ff.length - 1]?.url
            }
            if (!streamUrl) throw new Error('Stream tidak tersedia')

            // 5. Download ke buffer
            const audioResp = await axios.get(streamUrl, {
              responseType: 'arraybuffer', timeout: 60000,
              headers: { 'User-Agent': 'Mozilla/5.0' }
            })

            // 6. Kirim audio
            await sock.sendMessage(from, {
              audio: Buffer.from(audioResp.data),
              mimetype: 'audio/mpeg',
              fileName: `${title}.mp3`,
              ptt: false
            }, { quoted: m })

            await react('✅')
          } catch (e) {
            console.error('[MUSIK]', e.message)
            await react('❌')
            await reply(`❌ Gagal unduh lagu.\n${e.message}`)
          }
          break
        }

        // ── YTSEARCH — list hasil tanpa download ──
        case 'ytsearch':
        case 'cariyt': {
          const query = args.join(' ').trim()
          if (!query) { await reply(`🔍 Tulis kata kunci!\nContoh: ${cfg.prefix}ytsearch blinding lights`); break }
          await react('🔍')
          try {
            const results = await invReq('/search', {
              q: query, type: 'video', fields: 'videoId,title,author,lengthSeconds'
            })
            if (!Array.isArray(results) || results.length === 0) {
              await react('❌'); await reply(`❌ Tidak ditemukan hasil untuk *${query}*.`); break
            }

            const firstId = results[0].videoId
            let caption = `🔍 *Hasil: ${query}*\n`
            caption += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n`
            results.slice(0, 5).forEach((v, i) => {
              caption += `*${i + 1}.* ${v.title}\n`
              caption += `     👤 ${v.author}  ·  ⏱ ${fmtSec(v.lengthSeconds)}\n`
              caption += `     🔗 youtu.be/${v.videoId}\n\n`
            })
            caption += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`
            caption += `> Ketik *${cfg.prefix}musik <judul>* untuk download`

            try {
              const tResp = await axios.get(`https://i.ytimg.com/vi/${firstId}/mqdefault.jpg`, {
                responseType: 'arraybuffer', timeout: 6000
              })
              await sock.sendMessage(from, {
                image: Buffer.from(tResp.data),
                caption, mimetype: 'image/jpeg'
              }, { quoted: m })
            } catch {
              await reply(caption)
            }
            await react('✅')
          } catch {
            await react('❌'); await reply('❌ Gagal mencari. Coba lagi.')
          }
          break
        }

        // ── PAP (Pinterest) ──
        case 'pap':
        case 'anime': {
          const keyword = args.join(' ').trim()
          if (!keyword) { await reply(`Tulis keyword-nya!\nContoh: ${cfg.prefix}${cmd} sunset aesthetic`); break }
          await react('🔍')
          try {
            const res = await axios.get('https://api.betabotz.eu.org/api/search/pinterest', {
              params: { text1: keyword, apikey: cfg.aiApiKey }, timeout: 15000
            })
            const data = res.data
            const images = Array.isArray(data?.result) ? data.result
              : Array.isArray(data?.data) ? data.data
              : Array.isArray(data) ? data : null

            if (!images || images.length === 0) {
              await react('❌'); await reply('Foto tidak ditemukan, coba keyword lain.'); break
            }

            const urls = images.slice(0, 10)
            const mediaMessages = []
            for (const url of urls) {
              const imgUrl = typeof url === 'string' ? url : url?.url || url?.image || url?.link
              if (!imgUrl) continue
              try {
                const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 10000 })
                mediaMessages.push({ image: Buffer.from(imgRes.data), caption: '' })
              } catch {}
            }

            if (mediaMessages.length === 0) {
              await react('❌'); await reply('Gagal mengambil gambar.'); break
            }

            await react('✅')
            await reply(`🖼️ *${keyword}* — ${mediaMessages.length} foto ditemukan`)
            for (const msg of mediaMessages) {
              await sock.sendMessage(from, msg, { quoted: m })
              await new Promise(r => setTimeout(r, 500))
            }
          } catch (e) {
            await react('❌'); await reply(cfg.msg.error)
            console.error('[PAP]', e.message)
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
            await react('❌'); await reply(cfg.msg.error)
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
          const info =
`╭──── 🔌 *Eva API Access* ────
│
│ 📡 *Base URL*
│ https://cynix.tokopanel.my.id
│
│ 🔑 *Token (x-api-key)*
│ ${cfg.proxyToken}
│
│ 🤖 *AI Chat*
│ GET /ai?text=...&token=...
│
│ 🎵 *Music Search*
│ GET /music?query=...&token=...
│
│ 🎵 *YT Audio Stream*
│ GET /ytmp3?videoid=...&token=...
│
│ 🖼️ *Pinterest*
│ GET /pinterest?text=...&token=...
│
│ ⚠️ Jangan share token ini!
│
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
