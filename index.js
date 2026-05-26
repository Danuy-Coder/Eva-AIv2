const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, jidNormalizedUser, downloadMediaMessage } = require('@whiskeysockets/baileys')
const pino = require('pino')
const qrcode = require('qrcode-terminal')
const axios = require('axios')
const sharp = require('sharp')
const express = require('express')
const cfg = require('./setting')

const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) })

// ── DATA SEMENTARA ────────────────────────────────────────
const warnData = {}
const antilinkData = {}
const linkRegex = /(https?:\/\/|wa\.me|whatsapp\.com\/|bit\.ly|t\.me\/|chat\.whatsapp\.com)/i

// ── INVIDIOUS INSTANCES (fallback berurutan) ──────────────
const INV_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.drgnz.club',
  'https://iv.datura.network'
]

// Coba semua instance, return hasil pertama yang berhasil
async function invRequest(path, params = {}) {
  for (const base of INV_INSTANCES) {
    try {
      const url = `${base}/api/v1${path}`
      const res = await axios.get(url, { params, timeout: 8000 })
      if (res.data) return res.data
    } catch {
      continue
    }
  }
  throw new Error('Semua Invidious instance gagal')
}

// ── HELPER ───────────────────────────────────────────────
function getCmd(text, prefix) {
  if (!text || !text.startsWith(prefix)) return { cmd: null, args: [] }
  const parts = text.slice(prefix.length).trim().split(/\s+/)
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) }
}

const fmtSec = s => !s ? '' : `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

function getMenu() {
  const p = cfg.prefix
  return `╭──── ${cfg.botName} ────
│
│ 🤖 *AI*
│ ${p}ai <tanya>       — chat sama Eva
│
│ 🎵 *Musik*
│ ${p}musik <judul>    — cari & download lagu
│
│ 🛡️ *Manajemen Grup*
│ ${p}tagall           — tag semua member
│ ${p}hidetag <teks>   — tag tersembunyi
│ ${p}open             — buka grup
│ ${p}close            — tutup grup
│ ${p}kick @user       — keluarkan member
│ ${p}promote @user    — jadikan admin
│ ${p}demote @user     — turunkan admin
│ ${p}warn @user       — beri peringatan
│ ${p}antilink on/off
│
│ 🎨 *Lainnya*
│ ${p}sticker / ${p}s  — gambar → stiker
│ ${p}getapi           — info akses proxy API
│ ${p}menu             — tampilkan menu
│
╰────────────────────`
}

// ════════════════════════════════════════════════════════
// ── PROXY API SERVER ─────────────────────────────────────
// ════════════════════════════════════════════════════════
function startProxyServer() {

  const app = express()
  app.use(express.json())

  // ── CORS ─────────────────────────────────────────
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  // ── AUTH ─────────────────────────────────────────
  function authCheck(req, res, next) {
    const token = req.headers['x-api-key'] || req.query.token
    if (!token || token !== cfg.proxyToken) {
      return res.status(401).json({
        status: false,
        message: 'Unauthorized. Sertakan x-api-key yang valid.'
      })
    }
    next()
  }

  // ── GET /ai ──────────────────────────────────────
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

  // ── POST /ai ─────────────────────────────────────
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

  // ── GET /music ───────────────────────────────────
  // Contoh: /music?query=photograph+ed+sheeran&token=TOKENMU
  // Response: { status, result: [ { title, thumbnail, duration, url, videoId, author } ] }
  app.get('/music', authCheck, async (req, res) => {
    const query = req.query.query?.trim()
    if (!query) return res.status(400).json({ status: false, message: 'Parameter "query" wajib diisi.' })
    try {
      const results = await invRequest('/search', {
        q: query,
        type: 'video',
        fields: 'videoId,title,author,lengthSeconds,videoThumbnails'
      })

      if (!Array.isArray(results) || results.length === 0) {
        return res.json({ status: false, message: 'Tidak ditemukan hasil.' })
      }

      const formatted = results.slice(0, 8).map(v => ({
        title:     v.title,
        author:    v.author,
        duration:  fmtSec(v.lengthSeconds),
        seconds:   v.lengthSeconds,
        thumbnail: v.videoThumbnails?.find(t => t.quality === 'medium')?.url
                   || v.videoThumbnails?.[0]?.url || '',
        url:       `https://www.youtube.com/watch?v=${v.videoId}`,
        videoId:   v.videoId
      }))

      res.json({ status: true, result: formatted })

    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── GET /ytmp3 ───────────────────────────────────
  // Ambil stream audio dari video YouTube via Invidious
  // Contoh: /ytmp3?url=https://youtu.be/xxx&token=TOKENMU
  //      atau /ytmp3?videoid=xxxxx&token=TOKENMU
  // Response: { status, result: { title, thumbnail, duration, mp3 } }
  app.get('/ytmp3', authCheck, async (req, res) => {
    let videoId = req.query.videoid || req.query.videoId

    // Kalau dikasih full URL, extract videoId
    if (!videoId && req.query.url) {
      const match = req.query.url.match(/[?&]v=([^&]+)/) || req.query.url.match(/youtu\.be\/([^?&]+)/)
      if (match) videoId = match[1]
    }

    if (!videoId) {
      return res.status(400).json({
        status: false,
        message: 'Parameter "videoid" atau "url" wajib diisi.'
      })
    }

    try {
      const data = await invRequest(`/videos/${videoId}`, {
        fields: 'title,author,lengthSeconds,videoThumbnails,adaptiveFormats,formatStreams'
      })

      // Pilih audio stream terbaik (bitrate tertinggi)
      const audioFormats = (data.adaptiveFormats || [])
        .filter(f => f.type?.startsWith('audio/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))

      let streamUrl = audioFormats[0]?.url

      // Fallback ke format stream biasa (video+audio) kalau tidak ada audio-only
      if (!streamUrl) {
        const fallback = (data.formatStreams || [])
        streamUrl = fallback[fallback.length - 1]?.url
      }

      if (!streamUrl) throw new Error('Tidak ada stream tersedia')

      res.json({
        status: true,
        result: {
          title:     data.title,
          author:    data.author,
          duration:  fmtSec(data.lengthSeconds),
          thumbnail: data.videoThumbnails?.find(t => t.quality === 'medium')?.url
                     || data.videoThumbnails?.[0]?.url || '',
          mp3:       streamUrl  // URL langsung audio stream
        }
      })

    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── GET /pinterest ───────────────────────────────
  // Proxy ke betabotz (sudah ada sebelumnya, tetap dipertahankan)
  app.get('/pinterest', authCheck, async (req, res) => {
    const text = req.query.text?.trim()
    if (!text) return res.status(400).json({ status: false, message: 'Parameter "text" wajib diisi.' })
    try {
      const response = await axios.get('https://api.betabotz.eu.org/api/search/pinterest', {
        params: { query: text, apikey: 'Btz-Cynix' },
        timeout: 15000
      })
      res.json(response.data)
    } catch (e) {
      res.status(500).json({ status: false, message: e.message || 'Terjadi kesalahan.' })
    }
  })

  // ── ROOT ─────────────────────────────────────────
  app.get('/', (req, res) => {
    res.json({
      status: true,
      bot: cfg.botName,
      message: 'Proxy API aktif.',
      endpoints: {
        'GET /ai?text=...&token=...':          'Chat AI',
        'GET /music?query=...&token=...':       'Search lagu YouTube (via Invidious)',
        'GET /ytmp3?videoid=...&token=...':     'Get audio stream URL',
        'GET /pinterest?text=...&token=...':    'Search gambar Pinterest'
      }
    })
  })

  // ── START ────────────────────────────────────────
  app.listen(cfg.proxyPort, () => {
    console.log(`\n🌐 Proxy API aktif di port ${cfg.proxyPort}`)
    console.log(`   Endpoint AI      : https://cynix.tokopanel.my.id/ai`)
    console.log(`   Endpoint Music   : https://cynix.tokopanel.my.id/music`)
    console.log(`   Endpoint YT MP3  : https://cynix.tokopanel.my.id/ytmp3`)
    console.log(`   Endpoint Pinterest: https://cynix.tokopanel.my.id/pinterest\n`)
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
    getMessage: async key => {
      if (store) {
        const msg = await store.loadMessage(key.remoteJid, key.id)
        return msg?.message || undefined
      }
      return { conversation: 'hello' }
    }
  })

  store.bind(sock.ev)

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

        // ── MUSIK ─────────────────────────────────────
        // Cara pakai: .musik photograph ed sheeran
        // Bot akan search dulu, lalu otomatis download & kirim lagu #1
        case 'musik':
        case 'music':
        case 'lagu':
        case 'play': {
          const query = args.join(' ').trim()
          if (!query) {
            await reply(`🎵 Tulis judul lagu!\nContoh: ${cfg.prefix}musik photograph ed sheeran`)
            break
          }

          await react('🔍')

          try {
            // 1. Search via Invidious
            const searchRes = await invRequest('/search', {
              q: query,
              type: 'video',
              fields: 'videoId,title,author,lengthSeconds,videoThumbnails'
            })

            if (!Array.isArray(searchRes) || searchRes.length === 0) {
              await react('❌')
              await reply(`❌ Lagu *${query}* tidak ditemukan.`)
              break
            }

            // Ambil hasil pertama
            const video = searchRes[0]
            const videoId = video.videoId
            const title   = video.title
            const author  = video.author
            const durText = fmtSec(video.lengthSeconds)

            // Tolak video > 10 menit (terlalu besar)
            if (video.lengthSeconds > 600) {
              await react('❌')
              await reply(`❌ Video terlalu panjang (${durText}). Coba cari yang lebih pendek.`)
              break
            }

            await react('⏳')
            await reply(`🎵 Ditemukan: *${title}*\n👤 ${author} · ⏱ ${durText}\n\n⬇️ Sedang mengunduh...`)

            // 2. Ambil stream audio via Invidious
            const videoData = await invRequest(`/videos/${videoId}`, {
              fields: 'title,adaptiveFormats,formatStreams,videoThumbnails'
            })

            const audioFormats = (videoData.adaptiveFormats || [])
              .filter(f => f.type?.startsWith('audio/'))
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))

            let streamUrl = audioFormats[0]?.url
            if (!streamUrl) {
              const ff = videoData.formatStreams || []
              streamUrl = ff[ff.length - 1]?.url
            }

            if (!streamUrl) throw new Error('Stream tidak tersedia')

            // 3. Download stream ke buffer
            const audioResp = await axios.get(streamUrl, {
              responseType: 'arraybuffer',
              timeout: 60000,
              headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            const audioBuf = Buffer.from(audioResp.data)

            // 4. Kirim sebagai audio/dokumen
            // Coba kirim sebagai audio dulu, fallback ke dokumen
            const thumb = videoData.videoThumbnails?.find(t => t.quality === 'medium')?.url
                       || videoData.videoThumbnails?.[0]?.url

            let thumbBuf = null
            if (thumb) {
              try {
                const tRes = await axios.get(thumb, { responseType: 'arraybuffer', timeout: 5000 })
                thumbBuf = Buffer.from(tRes.data)
              } catch { /* thumbnail opsional */ }
            }

            await sock.sendMessage(from, {
              audio: audioBuf,
              mimetype: 'audio/mpeg',
              fileName: `${title}.mp3`,
              ptt: false
            }, { quoted: m })

            await react('✅')

          } catch (e) {
            console.error('[MUSIK]', e.message)
            await react('❌')
            await reply(`❌ Gagal mengunduh lagu.\nAlasan: ${e.message}`)
          }

          break
        }

        // ── YTSEARCH (list hasil tanpa download) ──────
        // Cara pakai: .ytsearch blinding lights
        case 'ytsearch':
        case 'cariyt': {
          const query = args.join(' ').trim()
          if (!query) {
            await reply(`🔍 Tulis kata kunci!\nContoh: ${cfg.prefix}ytsearch blinding lights`)
            break
          }

          await react('🔍')

          try {
            const results = await invRequest('/search', {
              q: query,
              type: 'video',
              fields: 'videoId,title,author,lengthSeconds'
            })

            if (!Array.isArray(results) || results.length === 0) {
              await react('❌')
              await reply(`❌ Tidak ditemukan hasil untuk *${query}*.`)
              break
            }

            const top5 = results.slice(0, 5)
            let text = `🔍 *Hasil pencarian: ${query}*\n\n`
            top5.forEach((v, i) => {
              text += `*${i + 1}.* ${v.title}\n`
              text += `   👤 ${v.author} · ⏱ ${fmtSec(v.lengthSeconds)}\n`
              text += `   🔗 https://youtu.be/${v.videoId}\n\n`
            })
            text += `_Balas dengan_ ${cfg.prefix}musik <judul> _untuk download._`

            await react('✅')
            await reply(text)

          } catch (e) {
            await react('❌')
            await reply(`❌ Gagal mencari. Coba lagi.`)
          }

          break
        }

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

        case 'open':
        case 'close': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          await sock.groupSettingUpdate(from, cmd === 'open' ? 'not_announcement' : 'announcement')
          await reply(cmd === 'open' ? '🔓 Grup dibuka.' : '🔒 Grup ditutup.')
          break
        }

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

        case 'hidetag':
        case 'ht': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          const members = groupMeta.participants.map(p => p.id)
          await sock.sendMessage(from, { text: args.join(' ') || '📢 Pengumuman', mentions: members })
          break
        }

        case 'kick': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          if (!target) { await reply('Tag member yang mau di-kick.'); break }
          await sock.groupParticipantsUpdate(from, [target], 'remove')
          await reply('✅ Member berhasil dikeluarkan.')
          break
        }

        case 'promote': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          if (!target) { await reply('Tag member yang mau dipromote.'); break }
          await sock.groupParticipantsUpdate(from, [target], 'promote')
          await reply('⬆️ Member berhasil dijadikan admin.')
          break
        }

        case 'demote': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          if (!isBotAdmin) { await reply(cfg.msg.onlyBotAdmin); break }
          if (!target) { await reply('Tag admin yang mau di-demote.'); break }
          await sock.groupParticipantsUpdate(from, [target], 'demote')
          await reply('⬇️ Admin berhasil diturunkan.')
          break
        }

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

        case 'antilink': {
          if (!isGroup) { await reply(cfg.msg.onlyGroup); break }
          if (!isAdmin && !isOwner) { await reply(cfg.msg.onlyAdmin); break }
          const mode = args[0]?.toLowerCase()
          if (!['on', 'off'].includes(mode)) { await reply('Gunakan: .antilink on / .antilink off'); break }
          antilinkData[from] = mode === 'on'
          await reply(`🛡️ Antilink *${mode === 'on' ? 'diaktifkan' : 'dimatikan'}*.`)
          break
        }

        case 'getapi': {
          const info = `╭──── 🔌 *Eva API Access* ────
│
│ 📡 *Endpoints*
│ https://cynix.tokopanel.my.id/ai
│ https://cynix.tokopanel.my.id/music
│ https://cynix.tokopanel.my.id/ytmp3
│
│ 🔑 *Token (x-api-key)*
│ ${cfg.proxyToken}
│
│ 📦 *Music search*
│ /music?query=lagu+artis&token=...
│
│ 📦 *YT ke MP3*
│ /ytmp3?videoid=xxxxx&token=...
│
│ ⚠️ Jangan share token ini!
│
╰──────────────────────────`
          await reply(info)
          break
        }

        default:
          break
      }
    }
  })
}

// ── START SEMUA ───────────────────────────────────────────
startProxyServer()
startBot()
