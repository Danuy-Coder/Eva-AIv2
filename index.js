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
│ ${p}ai <tanya>     — chat sama Eva
│
│ 🛡️ *Manajemen Grup*
│ ${p}tagall         — tag semua member
│ ${p}hidetag <teks> — tag tersembunyi
│ ${p}open           — buka grup
│ ${p}close          — tutup grup
│ ${p}kick @user     — keluarkan member
│ ${p}promote @user  — jadikan admin
│ ${p}demote @user   — turunkan admin
│ ${p}warn @user     — beri peringatan
│ ${p}antilink on/off
│
│ 🎨 *Lainnya*
│ ${p}sticker / ${p}s — gambar → stiker
│ ${p}getapi         — info akses proxy API
│ ${p}menu           — tampilkan menu
│
╰────────────────────`
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

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200)
    }

    next()
  })

  // AUTH
  function authCheck(req, res, next) {

    const token =
      req.headers['x-api-key'] ||
      req.query.token

    if (!token || token !== cfg.proxyToken) {
      return res.status(401).json({
        status: false,
        message: 'Unauthorized'
      })
    }

    next()
  }

  // ── AI ─────────────────────
  app.get('/ai', authCheck, async (req, res) => {

    const text = req.query.text?.trim()

    if (!text) {
      return res.json({
        status:false
      })
    }

    try {

      const response = await axios.get(
        cfg.aiApiUrl,
        {
          params:{
            text,
            logic:req.query.logic || cfg.aiLogic,
            apikey:cfg.aiApiKey
          }
        }
      )

      res.json({
        status:true,
        result:
          response.data.result ||
          response.data.answer ||
          response.data.message
      })

    } catch(e){

      res.json({
        status:false,
        message:e.message
      })

    }

  })

  // ── PINTEREST ─────────────────────
  app.get('/pinterest', authCheck, async (req,res)=>{

    const text = req.query.text?.trim()

    try{

      const response = await axios.get(
        'https://api.betabotz.eu.org/api/search/pinterest',
        {
          params:{
            text,
            apikey:'Btz-Cynix'
          }
        }
      )

      res.json(response.data)

    }catch(e){

      res.json({
        status:false,
        message:e.message
      })

    }

  })

  // ── MUSIC ─────────────────────
  app.get('/music', authCheck, async (req,res)=>{

    const query = req.query.query?.trim()

    if(!query){
      return res.json({
        status:false,
        message:'query kosong'
      })
    }

    try{

      const response = await axios.get(
        'https://api.betabotz.eu.org/api/search/yts',
        {
          params:{
            query,
            apikey:'Btz-Cynix'
          },
          timeout:15000
        }
      )

      res.json({
        status:true,
        result:response.data.result || []
      })

    }catch(e){

      res.json({
        status:false,
        message:e.message
      })

    }

  })

  // ROOT
  app.get('/', (req,res)=>{
    res.json({
      status:true,
      message:'API aktif'
    })
  })

  app.listen(cfg.proxyPort, ()=>{
    console.log('Proxy aktif')
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
      const botJid     = sock.user?.id
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

        // ── GETAPI ──
        case 'getapi': {
          const info = `╭──── 🔌 *Eva API Access* ────
│
│ 📡 *Endpoint*
│ https://cynix.tokopanel.my.id/ai
│
│ 🔑 *Token (x-api-key)*
│ ${cfg.proxyToken}
│
│ 📦 *Cara pakai (GET)*
│ https://cynix.tokopanel.my.id/ai
│ ?text=pertanyaan&token=${cfg.proxyToken}
│
│ 📦 *Cara pakai (POST)*
│ URL  : https://cynix.tokopanel.my.id/ai
│ Header: x-api-key: ${cfg.proxyToken}
│ Body  : { "text": "pertanyaan" }
│
│ ✅ *Response*
│ { "status": true, "result": "..." }
│
│ ⚠️ Jangan share token ini
│ ke sembarangan orang!
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

// ── START SEMUA ───────────────────────────────────────────
startProxyServer()
startBot()
