const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, jidNormalizedUser } = require('@whiskeysockets/baileys')
const pino = require('pino')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const path = require('path')
const cfg = require('./setting')

// ── STORE ────────────────────────────────────────────────
const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) })

// ── LOAD PLUGINS ─────────────────────────────────────────
const plugins = {}
const pluginDir = path.join(__dirname, 'plugins')
fs.readdirSync(pluginDir).filter(f => f.endsWith('.js')).forEach(file => {
  try {
    const plug = require(path.join(pluginDir, file))
    const name = file.replace('.js', '')
    plugins[name] = plug
    console.log(`[PLUGIN] Loaded: ${name}`)
  } catch(e) {
    console.error(`[PLUGIN] Gagal load ${file}:`, e.message)
  }
})

// ── HELPER ───────────────────────────────────────────────
function getCmd(text, prefix) {
  if (!text || !text.startsWith(prefix)) return { cmd: null, args: [] }
  const parts = text.slice(prefix.length).trim().split(/\s+/)
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) }
}

// ── MAIN ─────────────────────────────────────────────────
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

  // QR
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
      console.log(`\n[BOT] ${cfg.botName} terhubung! ✅\n`)
    }
  })

  sock.ev.on('creds.update', saveCreds)

  // ── MESSAGE HANDLER ───────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue

      // Parse pesan
      const from = m.key.remoteJid
      const isGroup = from.endsWith('@g.us')
      const sender = isGroup ? m.key.participant : from
      const senderNum = sender?.replace(/[^0-9]/g, '')
      const isOwner = cfg.ownerNumber.map(n => n.replace(/[^0-9]/g, '')).includes(senderNum)

      // Ambil teks
      const body =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption || ''

      const { cmd, args } = getCmd(body, cfg.prefix)

      // Group metadata
      let groupMeta = null, isAdmin = false, isBotAdmin = false
      if (isGroup) {
        try {
          groupMeta = await sock.groupMetadata(from)
          const admins = groupMeta.participants.filter(p => p.admin).map(p => p.id)
          isAdmin = admins.includes(sender)
          const botJid = jidNormalizedUser(sock.user.id)
          isBotAdmin = admins.includes(botJid)
        } catch {}
      }

      // Context objek yang dikirim ke plugin
      const ctx = {
        sock, m, from, sender, senderNum,
        isGroup, isOwner, isAdmin, isBotAdmin,
        groupMeta, body, args, cmd,
        cfg,
        // Helper reply
        reply: (text) => sock.sendMessage(from, { text }, { quoted: m }),
        react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: m.key } }),
      }

      // ── SWITCH CASE COMMAND ─────────────────────────
      if (cmd) {
        switch (cmd) {

          // ── GROUP MANAGEMENT ──
          case 'antilink':
          case 'antispam':
          case 'warn':
          case 'kick':
          case 'promote':
          case 'demote':
            if (plugins['group']) await plugins['group'].handler(ctx)
            break

          case 'open':
          case 'close':
            if (plugins['openclose']) await plugins['openclose'].handler(ctx)
            break

          case 'hidetag':
          case 'ht':
            if (plugins['hidetag']) await plugins['hidetag'].handler(ctx)
            break

          case 'tagall':
          case 'everyone':
            if (plugins['tagall']) await plugins['tagall'].handler(ctx)
            break

          // ── STICKER ──
          case 'sticker':
          case 's':
            if (plugins['sticker']) await plugins['sticker'].handler(ctx)
            break

          // ── AI ──
          case 'ai':
          case 'eva':
          case 'ask':
            if (plugins['ai']) await plugins['ai'].handler(ctx)
            break

          // ── MENU ──
          case 'menu':
          case 'help':
            await sendMenu(ctx)
            break

          default:
            // Tidak ada command yang cocok, abaikan
            break
        }
      }

      // ── AUTO AI (mention atau reply ke bot) ────────
      const botJidFull = sock.user?.id
      const isMentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botJidFull)
      const isReplyToBot = m.message?.extendedTextMessage?.contextInfo?.participant === botJidFull

      if (!cmd && (isMentioned || isReplyToBot || !isGroup)) {
        if (body.trim() && plugins['ai']) {
          await plugins['ai'].handler({ ...ctx, cmd: 'ai', args: body.split(' ') })
        }
      }

      // ── AUTO ANTI-LINK (auto aktif jika plugin siap) ──
      if (isGroup && !isAdmin && !isOwner && plugins['group']) {
        await plugins['group'].autoCheck(ctx)
      }
    }
  })

  // ── GROUP EVENTS ──────────────────────────────────────
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (!plugins['group']) return
    await plugins['group'].onParticipantsUpdate({ sock, id, participants, action, cfg })
  })
}

// ── MENU ─────────────────────────────────────────────────
async function sendMenu(ctx) {
  const { reply, cfg } = ctx
  const p = cfg.prefix
  const menu = `╭─── ${cfg.botName} Menu ───
│
│ 🤖 *AI*
│ ${p}ai <tanya> — chat sama Eva
│ ${p}eva <tanya> — sama aja
│
│ 🛡️ *Grup*
│ ${p}tagall — mention semua
│ ${p}hidetag <teks> — tag tersembunyi
│ ${p}open — buka grup
│ ${p}close — tutup grup
│ ${p}kick @user — keluarkan member
│ ${p}promote @user — jadikan admin
│ ${p}demote @user — cabut admin
│ ${p}antilink on/off — anti link
│
│ 🎨 *Lainnya*
│ ${p}sticker — gambar → stiker
│
╰──────────────────`
  await reply(menu)
}

startBot()
