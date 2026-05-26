const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
  downloadMediaMessage
} = require('@whiskeysockets/baileys')

const pino = require('pino')
const qrcode = require('qrcode-terminal')
const axios = require('axios')
const sharp = require('sharp')
const express = require('express')
const fs = require('fs')

const cfg = require('./setting')

const thumbBuffer = fs.readFileSync('./media/thumb.jpg')

const store = makeInMemoryStore({
  logger: pino({ level: 'silent' })
})

// ── DATA SEMENTARA ────────────────────────────────────────
const warnData = {}
const antilinkData = {}

const linkRegex =
  /(https?:\/\/|wa\.me|whatsapp\.com\/|bit\.ly|t\.me\/|chat\.whatsapp\.com)/i

// ── RUNTIME ──────────────────────────────────────────────
const startedAt = Date.now()

function runtime() {

  const ms = Date.now() - startedAt

  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60

  return `${h}h ${m}m ${s}s`
}

// ── HELPER ───────────────────────────────────────────────
function getCmd(text, prefix) {

  if (!text || !text.startsWith(prefix))
    return { cmd: null, args: [] }

  const parts =
    text
      .slice(prefix.length)
      .trim()
      .split(/\s+/)

  return {
    cmd: parts[0].toLowerCase(),
    args: parts.slice(1)
  }
}

function getMenu() {

  const p = cfg.prefix

  return `╭━〔 ${cfg.botName} 〕━⬣
┃
┃ 🤖 *AI MENU*
┃ ${p}ai <text>
┃ ${p}eva <text>
┃ ${p}ask <text>
┃
┃ 👥 *GROUP MENU*
┃ ${p}tagall
┃ ${p}hidetag
┃ ${p}open
┃ ${p}close
┃ ${p}kick
┃ ${p}promote
┃ ${p}demote
┃ ${p}warn
┃ ${p}antilink on/off
┃
┃ 🎨 *TOOLS MENU*
┃ ${p}s
┃ ${p}sticker
┃
┃ 🌐 *API MENU*
┃ ${p}getapi
┃ ${p}cekapi
┃
┃ ⚙️ *OWNER MENU*
┃ ${p}setlogic
┃ ${p}runtime
┃
┃ 📌 *INFO BOT*
┃ Runtime : ${runtime()}
┃ Prefix : ${cfg.prefix}
┃ Owner : ${cfg.ownerName}
┃
╰━━━━━━━━━━━━⬣`
}

// ════════════════════════════════════════════════════════
// ── PROXY API SERVER ─────────────────────────────────────
// ════════════════════════════════════════════════════════
function startProxyServer() {

  const app = express()

  app.use(express.json())

  app.use((req, res, next) => {

    res.header('Access-Control-Allow-Origin', '*')

    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key'
    )

    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS'
    )

    if(req.method === 'OPTIONS')
      return res.sendStatus(200)

    next()
  })

  function authCheck(req, res, next) {

    const token =
      req.headers['x-api-key'] ||
      req.query.token

    if(!token || token !== cfg.proxyToken){

      return res.status(401).json({
        status:false,
        message:'Unauthorized'
      })
    }

    next()
  }

  app.get('/ai', authCheck, async (req, res) => {

    const text =
      req.query.text?.trim()

    const logic =
      req.query.logic ||
      cfg.aiLogic

    if(!text){

      return res.status(400).json({
        status:false,
        message:'Text wajib diisi'
      })
    }

    try{

      const response =
        await axios.get(
          cfg.aiApiUrl,
          {
            params:{
              text,
              logic,
              apikey:cfg.aiApiKey
            },
            timeout:15000
          }
        )

      const result =
        response.data?.result ||
        response.data?.answer ||
        response.data?.message

      res.json({
        status:true,
        result
      })

    }catch(e){

      res.status(500).json({
        status:false,
        message:e.message
      })
    }
  })

  app.listen(cfg.proxyPort, () => {

    console.log(
      `🌐 Proxy aktif di port ${cfg.proxyPort}`
    )
  })
}

// ════════════════════════════════════════════════════════
// ── WHATSAPP BOT ─────────────────────────────────────────
// ════════════════════════════════════════════════════════
async function startBot() {

  const { state, saveCreds } =
    await useMultiFileAuthState('./session')

  const { version } =
    await fetchLatestBaileysVersion()

  const sock = makeWASocket({

    version,

    logger: pino({
      level: 'silent'
    }),

    printQRInTerminal: false,

    auth: state,

    browser: [
      'Eva Bot',
      'Chrome',
      '1.0.0'
    ],

    getMessage: async key => {

      if (store) {

        const msg =
          await store.loadMessage(
            key.remoteJid,
            key.id
          )

        return msg?.message || undefined
      }

      return {
        conversation: 'hello'
      }
    }
  })

  store.bind(sock.ev)

  sock.ev.on(
    'connection.update',
    ({ connection, lastDisconnect, qr }) => {

      if (qr) {

        console.log('\n[QR] Scan QR berikut:\n')

        qrcode.generate(qr, {
          small: true
        })
      }

      if (connection === 'close') {

        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut

        console.log(
          '[BOT] Koneksi terputus.',
          shouldReconnect
            ? 'Reconnecting...'
            : 'Logged out.'
        )

        if (shouldReconnect)
          startBot()

      } else if (connection === 'open') {

        console.log(
          `✅ ${cfg.botName} terhubung!`
        )
      }
    }
  )

  sock.ev.on(
    'creds.update',
    saveCreds
  )

  // ── WELCOME ─────────────────────────────
  sock.ev.on(
    'group-participants.update',
    async ({ id, participants, action }) => {

      for (const participant of participants) {

        const num =
          participant.replace(
            '@s.whatsapp.net',
            ''
          )

        if (action === 'add') {

          await sock.sendMessage(id, {

            image: thumbBuffer,

            caption:
`╭━〔 WELCOME 〕━⬣
┃
┃ 👋 Halo @${num}
┃ Selamat datang di grup.
┃ Jangan lupa baca rules.
┃
╰━━━━━━━━━━━━⬣`,

            mentions: [participant]

          })

        } else if (action === 'remove') {

          await sock.sendMessage(id, {

            image: thumbBuffer,

            caption:
`╭━〔 GOODBYE 〕━⬣
┃
┃ 👋 Sampai jumpa @${num}
┃
╰━━━━━━━━━━━━⬣`,

            mentions: [participant]

          })
        }
      }
    }
  )

  // ── MESSAGE ─────────────────────────────
  sock.ev.on(
    'messages.upsert',
    async ({ messages, type }) => {

      if (type !== 'notify')
        return

      for (const m of messages) {

        if (!m.message || m.key.fromMe)
          continue

        const from =
          m.key.remoteJid

        const isGroup =
          from.endsWith('@g.us')

        const sender =
          isGroup
            ? m.key.participant
            : from

        const senderNum =
          sender?.replace(/[^0-9]/g, '')

        const isOwner =
          cfg.ownerNumber
            .map(n =>
              n.replace(/[^0-9]/g, '')
            )
            .includes(senderNum)

        const body =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.imageMessage?.caption ||
          m.message?.videoMessage?.caption ||
          ''

        const { cmd, args } =
          getCmd(body, cfg.prefix)

        const reply = async (
          text,
          title = cfg.botName
        ) => {

          return await sock.sendMessage(
            from,
            {
              text,
              contextInfo: {
                externalAdReply: {
                  title,
                  body: cfg.botName,
                  thumbnail: thumbBuffer,
                  mediaType: 1,
                  renderLargerThumbnail: true,
                  showAdAttribution: false
                }
              }
            },
            { quoted: m }
          )
        }

        const react = emoji =>
          sock.sendMessage(
            from,
            {
              react: {
                text: emoji,
                key: m.key
              }
            }
          )

        let groupMeta = null
        let isAdmin = false
        let isBotAdmin = false

        if (isGroup) {

          try {

            groupMeta =
              await sock.groupMetadata(from)

            const admins =
              groupMeta.participants
                .filter(p => p.admin)
                .map(p => p.id)

            isAdmin =
              admins.includes(sender)

            isBotAdmin =
              admins.includes(
                jidNormalizedUser(sock.user.id)
              )

          } catch {}
        }

        const mentioned =
          m.message?.extendedTextMessage
            ?.contextInfo?.mentionedJid || []

        const target =
          mentioned[0] ||
          (
            args[0]
              ? args[0]
                  .replace(/[^0-9]/g, '') +
                '@s.whatsapp.net'
              : null
          )

        // ── AUTO ANTILINK ─────────────────────
        if (
          isGroup &&
          !isAdmin &&
          !isOwner &&
          antilinkData[from] &&
          linkRegex.test(body)
        ) {

          if (isBotAdmin) {

            await sock.sendMessage(
              from,
              { delete: m.key }
            )

            await sock.groupParticipantsUpdate(
              from,
              [sender],
              'remove'
            )

            await sock.sendMessage(
              from,
              {
                text:
                  '🚫 Link tidak diizinkan.'
              }
            )

          } else {

            await reply(
              '🚫 Link tidak diizinkan.'
            )
          }

          continue
        }

        // ── AUTO AI ───────────────────────────
        const botJid =
          sock.user?.id

        const isMentioned =
          m.message?.extendedTextMessage
            ?.contextInfo?.mentionedJid
            ?.includes(botJid)

        const isReplyBot =
          m.message?.extendedTextMessage
            ?.contextInfo?.participant ===
          botJid

        if (
          !cmd &&
          body.trim() &&
          (
            isMentioned ||
            isReplyBot ||
            !isGroup
          )
        ) {

          await react('🤔')

          try {

            const res =
              await axios.get(
                cfg.aiApiUrl,
                {
                  params: {
                    text: body,
                    logic: cfg.aiLogic,
                    apikey: cfg.aiApiKey
                  },
                  timeout: 15000
                }
              )

            const result =
              res.data?.result ||
              res.data?.answer ||
              res.data?.message

            await react('✅')

            await sock.sendMessage(
              from,
              {
                image: thumbBuffer,

                caption:
`╭━〔 ${cfg.botName} AI 〕━⬣
┃
┃ ${result}
┃
╰━━━━━━━━━━━━⬣`
              },
              { quoted: m }
            )

          } catch {

            await react('❌')

            await reply(cfg.msg.error)
          }

          continue
        }

        if (!cmd)
          continue

        // ── COMMAND ───────────────────────────
        switch (cmd) {

          case 'menu':
          case 'help': {

            await sock.sendMessage(
              from,
              {
                image: thumbBuffer,
                caption: getMenu()
              },
              { quoted: m }
            )

            break
          }

          case 'runtime': {

            await reply(
              `⏰ Runtime: ${runtime()}`
            )

            break
          }

          case 'ai':
          case 'eva':
          case 'ask': {

            const text =
              args.join(' ').trim()

            if (!text) {

              await reply(
                `Contoh:\n${cfg.prefix}ai halo`
              )

              break
            }

            await react('🤔')

            try {

              const res =
                await axios.get(
                  cfg.aiApiUrl,
                  {
                    params: {
                      text,
                      logic: cfg.aiLogic,
                      apikey: cfg.aiApiKey
                    },
                    timeout: 15000
                  }
                )

              const result =
                res.data?.result ||
                res.data?.answer ||
                res.data?.message

              await react('✅')

              await sock.sendMessage(
                from,
                {
                  image: thumbBuffer,

                  caption:
`╭━〔 ${cfg.botName} AI 〕━⬣
┃
┃ ${result}
┃
╰━━━━━━━━━━━━⬣`
                },
                { quoted: m }
              )

            } catch {

              await react('❌')

              await reply(cfg.msg.error)
            }

            break
          }

          case 'sticker':
          case 's': {

            const isImg =
              m.message?.imageMessage ||
              m.message?.extendedTextMessage
                ?.contextInfo
                ?.quotedMessage
                ?.imageMessage

            if (!isImg) {

              await reply(
                '📸 Kirim/reply gambar dengan caption .s'
              )

              break
            }

            await react('⏳')

            try {

              const buf =
                await downloadMediaMessage(
                  m,
                  'buffer',
                  {},
                  {
                    reuploadRequest:
                      sock.updateMediaMessage
                  }
                )

              const webp =
                await sharp(buf)
                  .resize(512, 512, {
                    fit: 'contain',
                    background: {
                      r: 0,
                      g: 0,
                      b: 0,
                      alpha: 0
                    }
                  })
                  .webp()
                  .toBuffer()

              await sock.sendMessage(
                from,
                {
                  sticker: webp,
                  mimetype: 'image/webp'
                },
                { quoted: m }
              )

              await react('✅')

              await reply(
                '✅ Sticker berhasil dibuat!'
              )

            } catch {

              await react('❌')

              await reply(cfg.msg.error)
            }

            break
          }

          case 'open':
          case 'close': {

            if (!isGroup) {

              await reply(cfg.msg.onlyGroup)

              break
            }

            if (!isAdmin && !isOwner) {

              await reply(cfg.msg.onlyAdmin)

              break
            }

            if (!isBotAdmin) {

              await reply(cfg.msg.onlyBotAdmin)

              break
            }

            await sock.groupSettingUpdate(
              from,
              cmd === 'open'
                ? 'not_announcement'
                : 'announcement'
            )

            await reply(
              cmd === 'open'
                ? '🔓 Grup berhasil dibuka.'
                : '🔒 Grup berhasil ditutup.'
            )

            break
          }

          case 'antilink': {

            if (!isGroup) {

              await reply(cfg.msg.onlyGroup)

              break
            }

            if (!isAdmin && !isOwner) {

              await reply(cfg.msg.onlyAdmin)

              break
            }

            const mode =
              args[0]?.toLowerCase()

            if (
              !['on', 'off'].includes(mode)
            ) {

              await reply(
                'Gunakan: .antilink on/off'
              )

              break
            }

            antilinkData[from] =
              mode === 'on'

            await reply(
              `🛡️ Antilink ${mode}`
            )

            break
          }

          case 'cekapi': {

            await react('⏳')

            try {

              const res =
                await axios.get(
                  `http://localhost:${cfg.proxyPort}/ai`,
                  {
                    params: {
                      text: 'halo',
                      token: cfg.proxyToken
                    }
                  }
                )

              await react('✅')

              await reply(
`╭━〔 API STATUS 〕━⬣
┃
┃ ✅ API ONLINE
┃
┃ ${res.data.result}
┃
╰━━━━━━━━━━━━⬣`
              )

            } catch(e) {

              await react('❌')

              await reply(
                `❌ ${e.message}`
              )
            }

            break
          }

          case 'setlogic': {

            if (!isOwner) {

              await reply(
                'Fitur khusus owner.'
              )

              break
            }

            const text =
              args.join(' ')

            if (!text) {

              await reply(
                'Masukkan logic baru.'
              )

              break
            }

            cfg.aiLogic = text

            await reply(
              '✅ Logic AI berhasil diubah.'
            )

            break
          }

          case 'getapi': {

            const info =
`╭━〔 EVA API ACCESS 〕━⬣
┃
┃ 🌐 Endpoint:
┃ https://cynix.tokopanel.my.id/ai
┃
┃ 🔑 API KEY:
┃ ${cfg.proxyToken}
┃
╰━━━━━━━━━━━━⬣`

            await reply(info)

            break
          }

          default:
            break
        }
      }
    }
  )
}

// ── START ─────────────────────────────────────
startProxyServer()
startBot()
