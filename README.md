# WayFold

Diario di viaggio multi-utente: carichi le foto dalla **web app** o via **Telegram** e le rivedi in un'interfaccia elegante con timeline, galleria e mappa interattiva. Ogni utente ha il proprio account; i viaggi possono essere **condivisi** con altri tramite codice invito.

Interfaccia disponibile in **italiano, inglese, francese, spagnolo e tedesco**.

## Come funziona

- **Registrazione**: username, password ed **email**. Dopo la registrazione serve la **verifica email** (codice a 6 cifre) per usare l'app. Recupero password via email se SMTP è configurato.
- **Viaggi propri**: crei album dal web o da Telegram. Ogni viaggio web crea un topic nel gruppo Telegram (prefisso `[username]` nel nome). Le foto si sincronizzano in entrambe le direzioni: creazione/rinomina/eliminazione topic, invio file, cancellazione messaggi.
- **Topic Telegram**: un topic del gruppo Forum diventa un viaggio. Se il nome inizia con `[username]`, il viaggio viene assegnato a quell'utente registrato.
- **Condivisione album**: il proprietario genera un **codice invito** (solo lettura o anche upload). Un altro utente lo inserisce in Galleria e ottiene accesso all'album senza vedere gli altri viaggi del proprietario.
- **Geocoding ed EXIF**: paese, bandiera, continente e coordinate dalla destinazione (Nominatim/OpenStreetMap). Data delle foto dai metadati **EXIF** quando presenti.

## Avvio rapido

**Requisiti:** Node.js ≥ 18.

```bash
# 1. Dipendenze
npm install

# 2. Configurazione
cp .env.example .env
# → compila almeno SESSION_SECRET, BOT_TOKEN, GROUP_ID e SMTP (per email)

# 3. Avvia bot + server + tunnel Cloudflare
npm start
# → web app su http://localhost:3000
# → in console compare anche l'URL https://….trycloudflare.com

# Solo server (senza bot né tunnel)
npm run server

# Solo bot Telegram
npm run bot
```

> **Una sola istanza:** non avviare più `npm start` in parallelo — il bot in polling va in conflitto e la porta 3000 resta occupata.

### Setup Telegram

1. Crea un bot con [@BotFather](https://t.me/BotFather) (`/newbot`) → copia il token nel `.env` come `BOT_TOKEN`
2. Crea un gruppo Telegram e attiva gli **Argomenti** (Impostazioni gruppo → Argomenti)
3. Aggiungi il bot al gruppo come **amministratore** con permessi **Gestione argomenti** e **Eliminazione messaggi**
4. Scrivi un messaggio nel gruppo: il bot logga il `Chat ID` in console
5. Copia quell'ID nel `.env` come `GROUP_ID` e riavvia

Comandi admin del bot (per amministratori del gruppo o ID in `BOT_ADMIN_IDS`): `/status`, `/users`, `/finduser`, `/resetpassword`, `/deleteaccount`, `/help`.

> Le foto inviate come "foto" vengono compresse da Telegram. Per qualità originale invia come **file** (tieni premuto → Invia come file). Gli upload dal web vengono sempre inviati come file.

### Setup email (verifica account e reset password)

Configura SMTP nel `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). In sviluppo, con `MAIL_LOG_CODES=true`, i codici vengono stampati in console se SMTP non è raggiungibile.

## Interfaccia web

| Vista | Contenuto |
|---|---|
| **Diario** | Hero, KPI, timeline cronologica, lista viaggi scrollabile |
| **Galleria** | Picker viaggi scrollabile, upload drag & drop, lightbox, condivisione codici |
| **Mappa** | Leaflet con pin per tappa, lista viaggi laterale |
| **Account** | Cambio password, email, eliminazione account |

Scorciatoie: **Ctrl+K** palette comandi, tema chiaro/scuro, suggerimenti destinazione (Nominatim), tooltip personalizzati.

## Sicurezza

- **Autenticazione**: password con bcrypt, sessioni firmate su file, cookie `httpOnly` + `SameSite` + `Secure` (dietro HTTPS), session ID rigenerato al login, verifica email obbligatoria per le API dei viaggi.
- **Isolamento**: ogni risorsa è verificata contro l'utente della sessione (o membership album condiviso). Risorse altrui → **404** indistinguibile da "inesistente". Le foto non sono mai servite come file statici pubblici.
- **Upload**: tipo file verificato dai **magic bytes** (JPEG/PNG/WebP/HEIC), max 25 MB a file, 12 file per richiesta, quota per utente (default 500 MB / 1000 foto), nomi file generati dal server.
- **Email**: normalizzazione indirizzi Gmail (canonical email) per bloccare duplicati con alias `+` o punti.
- **Anti-abuso**: rate limit globale e per endpoint (login, registrazione, upload, codici condivisione…), body JSON max 16 KB, coda verso Telegram, helmet con Content-Security-Policy.
- **API**: serializzazione con allowlist — ID Telegram, percorsi interni e hash non escono dal server.

Test automatici: `node scripts/security-test.js` (con server attivo).

## Architettura

```
server/                 API Express + web app statica
├── index.js            bootstrap: helmet, sessioni, rate limit, foto protette
├── config.js           variabili d'ambiente
├── routes/             auth, trips, photos, shares, share-codes, status
├── middleware/         auth, uploadGuard (magic bytes, quote)
├── services/           trip, auth, share, telegram, exif, geocode, mail, photoServe
└── db/                 persistenza JSON (write-lock, scrittura atomica)

bot/                    Bot Telegram (polling, processo separato dal server)
├── index.js
├── handlers/           topics, media, commands, callbacks, inline
└── utils/              admin, download, user picker

public/                 Web app (vanilla JS, ES modules, no bundler)
├── index.html
├── css/styles.css
└── js/
    ├── main.js         boot, sync, i18n
    ├── router.js       Diario / Galleria / Mappa / Account
    ├── i18n.js         IT, EN, FR, ES, DE
    ├── api.js          client API (401 → login)
    ├── state.js        stato centralizzato
    ├── ui/             auth, modal, lightbox, share, journeyScroll, tooltip…
    └── views/          road, gallery, map, account, journeyList

db.json                 database (creato automaticamente, gitignored)
photos/{tripId}/        cache locale foto in produzione (gitignored)
sessions/               sessioni attive (gitignored)
tools/cloudflared.exe   binario tunnel (gitignored)
```

In locale (`BASE_URL` con localhost) le immagini restano su Telegram; in produzione vengono anche salvate su disco (`PHOTOS_KEEP_LOCAL`, forzabile nel `.env`).

## API

Le route `/api/trips`, `/api/photos`, `/api/shares` e `/api/share-codes` richiedono sessione valida **ed email verificata**.

| Metodo | Route | Descrizione |
|---|---|---|
| POST | `/api/auth/register` | Registrazione (username, password, email) |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Utente corrente |
| POST | `/api/auth/password` | Cambio password |
| POST | `/api/auth/email` | Aggiorna email (nuova verifica) |
| POST | `/api/auth/verify-email` | Verifica email con codice |
| POST | `/api/auth/resend-verification` | Reinvia codice verifica |
| POST | `/api/auth/forgot-password` | Richiesta reset password |
| POST | `/api/auth/reset-password` | Reset con codice |
| DELETE | `/api/auth/account` | Elimina account |
| GET | `/api/status` | Conteggi utente (+ stato Telegram se configurato) |
| GET | `/api/trips` | Viaggi accessibili (propri + condivisi) |
| POST | `/api/trips` | Crea viaggio (+ topic Telegram) |
| GET | `/api/trips/places` | Autocomplete destinazioni (Nominatim) |
| GET/PATCH/DELETE | `/api/trips/:id` | Lettura/modifica/eliminazione |
| GET | `/api/trips/:id/photos` | Foto del viaggio |
| POST | `/api/trips/:id/photos` | Upload foto (multipart) |
| POST | `/api/trips/:id/cover` | Imposta copertina |
| POST | `/api/trips/:id/share-codes` | Genera codice condivisione |
| GET | `/api/trips/:id/share-codes` | Elenco codici |
| GET | `/api/trips/:id/members` | Membri album condiviso |
| DELETE | `/api/trips/:id/members/:userId` | Rimuovi membro |
| PATCH | `/api/photos/:id` | Modifica nota/didascalia |
| DELETE | `/api/photos/:id` | Elimina foto |
| POST | `/api/shares/redeem` | Riscatta codice invito album |
| DELETE | `/api/share-codes/:id` | Revoca codice |
| GET | `/photos/:tripId/:file` | File immagine (autenticato, solo con accesso) |

## Variabili d'ambiente

| Nome | Descrizione |
|---|---|
| `BOT_TOKEN` | Token del bot Telegram |
| `GROUP_ID` | ID del gruppo Forum |
| `BOT_ADMIN_IDS` | ID Telegram admin bot (virgola-separati, opzionale) |
| `PORT` | Porta server (default 3000) |
| `BASE_URL` | URL pubblico (log e comportamento cache foto) |
| `SESSION_SECRET` | Segreto cookie sessione (**obbligatorio**) |
| `UPLOAD_QUOTA_MB` | Quota disco per utente (default 500) |
| `UPLOAD_MAX_PHOTOS` | Max foto per utente (default 1000) |
| `PHOTOS_KEEP_LOCAL` | `true`/`false` — forza salvataggio foto su disco |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Server SMTP |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Credenziali e mittente email |
| `MAIL_LOG_CODES` | In dev: stampa codici in console se SMTP assente |

Vedi `.env.example` per i valori di default e i commenti.
