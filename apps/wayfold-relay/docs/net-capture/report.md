# Report di cattura: navigazione WayFold Rete

- **Data:** 21/11/2026, finestra del test 22:58:55.9–22:59:23.6 UTC
- **Ambiente:** produzione `https://transfer.wayfold.xyz`, relay release 20261121224233
- **Obiettivo:** stabilire quale traffico è intercettabile durante una navigazione e da quale macchina parte verso Internet
- **Grafico dei collegamenti:** [grafico-collegamenti.md](grafico-collegamenti.md)

## Esito in breve

1. Il traffico verso il sito visitato parte **solo dal server Hetzner** (167.233.121.159), dal container Wisp tramite NAT Docker. Wikipedia non vede mai l'IP di casa.
2. Il PC che naviga **non ha contattato Wikipedia**: nessuna query DNS, nessun SNI e nessuna connessione verso host diversi da `transfer.wayfold.xyz`. Il suo tentativo di accesso diretto è fallito, come previsto dal controllo negativo.
3. Il PC che condivide trasporta la navigazione in **un solo WebSocket** `wss://transfer.wayfold.xyz/wisp/`, che apre 0,7 s dopo l'avvio della navigazione.
4. Anche decifrando quel WebSocket con le chiavi di sessione si vedono solo **i nomi host di destinazione** (en.m.wikipedia.org, en.wikipedia.org, thumb.wikimedia.org) e i volumi. URL, intestazioni e contenuti restano protetti dal TLS 1.3 interno, che va dal browser del PC che naviga fino a Wikipedia: 0 occorrenze di HTTP in chiaro.
5. La pagina si è caricata in 12,4 s. I volumi coincidono su ogni tratta (circa 205 KB), quindi non c'è traffico nascosto.

## Metodo

| Punto di cattura | Strumento | Cosa registra |
|---|---|---|
| PC di test, interfaccia Wi-Fi | tshark 4.4.2 + Npcap | tutto il traffico in uscita dal PC |
| Server Hetzner, interfaccia `any` | tcpdump (escluso SSH) | ingresso nginx, loopback nginx→Wisp, bridge Docker, uscita `eth0` |
| PC di test, tabella socket | `Get-NetTCPConnection` ogni 300 ms | quale processo Chrome possiede ogni connessione |
| Ciascun Chrome | `--ssl-key-log-file` separato | chiavi TLS per decifrare e attribuire ogni sessione |

Accorgimenti adottati:

- **Due istanze Chrome isolate** con profili separati: "Condividi" (PID 19204) e "Collegati" (PID 42592). Ogni sessione TLS è attribuita al processo confrontando il *client random* del ClientHello con il file di chiavi di quel Chrome. È un'attribuzione certa, non per tempistica.
- **PC che naviga senza accesso a Internet di fatto:** `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE transfer.wayfold.xyz` gli permette di risolvere solo il dominio dell'app. Il controllo negativo (`fetch` diretto verso Wikipedia) ha dato `BLOCCATO: Failed to fetch`.
- Traffico di fondo di Chrome ridotto (`--disable-background-networking`, `--disable-component-update`, `--disable-sync` e altri).
- Timeline degli eventi del test in `pcap/timeline.json`, allineata ai timestamp delle catture.
- **Minimizzazione:** la cattura grezza del server, che poteva contenere traffico di altri visitatori, è stata filtrata sulle sole tratte del test e poi cancellata sia dal server sia in locale.

### Limiti del test

- I due Chrome girano sullo stesso PC. Il canale ottico è simulato: i fotogrammi QR passano da una pagina all'altra tramite DevTools su `127.0.0.1` (1.847 fotogrammi, nessun pacchetto sul Wi-Fi). Con due PC reali quel tratto è solo luce, schermo verso fotocamera.
- Il PC che naviga aveva una scheda di rete attiva, limitata via DNS, non un vero isolamento fisico.
- Lo screenshot finale (`pcap/screenshot-browse.png`) mostra l'area pagina ancora bianca: è stato scattato 0,8 s dopo che il DOM conteneva già il testo della pagina, mentre i CSS di Wikipedia erano ancora in arrivo.

## Evidenze

### 1. PC di test (Wi-Fi 192.168.1.101)

Sessioni TLS nella finestra del test, attribuite tramite chiavi:

| Processo | Destinazione (SNI) | Porte locali | Contenuto decifrato |
|---|---|---|---|
| Chrome Condividi | transfer.wayfold.xyz | 3515, 27161, 60687, 45559, 45329, 32015, 49245 | download dell'app (`/`, `/assets/*`, `/sw.js`, icone) |
| Chrome Condividi | transfer.wayfold.xyz | **2549** | `GET /wisp/` Upgrade websocket: **il tunnel di navigazione** |
| Chrome Condividi | accounts.google.com, www.gstatic.com | 37128, 38698 | servizi interni di Chrome, non dell'app |
| Chrome Condividi | fonts.googleapis.com, fonts.gstatic.com | 16387 | Google Fonts richiesti dalle pagine dell'app |
| Chrome Collegati | transfer.wayfold.xyz | 44002, 61046, 55564, 32178, 33129, 43022, 59845 | solo download dell'app: `/`, `/assets/*`, `/browse/`, `/browse/uv/*`, `/browse/baremux/worker.js`, `proxy-transport` |
| non attribuito | transfer.wayfold.xyz | 1057, 40065 | solo handshake (6,9 KB ciascuna, nessuna richiesta): preconnessioni speculative di Chrome, stessa impronta JA4 |

Gli altri flussi del PC nella stessa finestra (api2.cursor.sh, r.stripe.com, catalog.gamepass.com, kinesis AWS) appartengono ad applicazioni estranee al test.

Ricerca di `wikipedia` e `wikimedia` nei nomi DNS e negli SNI dell'intera cattura del PC: **nessun risultato**.

### 2. Contenuto del tunnel `/wisp/` (decifrato con le chiavi del Chrome Condividi)

| Stream Wisp | CONNECT | Primo pacchetto (UTC) | Record TLS interni | SNI interno |
|---|---|---|---|---|
| 1 | en.m.wikipedia.org:443 TCP | 22:59:11.775 | Handshake 2, ChangeCipherSpec 1, ApplicationData 7 | en.m.wikipedia.org |
| 2 | en.wikipedia.org:443 TCP | 22:59:13.210 | Handshake 2, ChangeCipherSpec 1, ApplicationData 11 | en.wikipedia.org |
| 3 | thumb.wikimedia.org:443 TCP | 22:59:22.237 | Handshake 1 | thumb.wikimedia.org |

Corrispondenze di HTTP in chiaro (`GET /`, `HTTP/1.1`, `<html`) nei payload: **0**. Il dettaglio è in `pcap/wisp-decoded.json`.

### 3. Server Hetzner

| Tratta | Interfaccia | Evidenza |
|---|---|---|
| Ingresso | eth0 | SYN da **31.27.219.44:41260** (IP pubblico di casa) verso :443 alle 22:59:11.098 |
| nginx → Wisp | lo, poi docker0 | `GET /wisp/` in chiaro con `X-Real-IP: 31.27.219.44`, `Origin: https://transfer.wayfold.xyz`, User-Agent HeadlessChrome/157 |
| Risoluzione nomi | eth0 | il container 172.17.0.2 interroga 185.12.64.1 e 185.12.64.2 (DNS Hetzner) per i tre nomi, subito prima di ogni connessione in uscita (22:59:11.826, 13.255, 22.281) |
| Uscita | docker0, poi eth0 | SYN da 172.17.0.2, tradotto in **167.233.121.159** → 185.15.59.224:443, con ClientHello SNI identico a quello generato dal browser del PC che naviga |

### 4. Volumi per tratta (finestra del test, byte di frame)

| Tratta | Pacchetti | Byte |
|---|---|---|
| PC → server, WebSocket `/wisp/` (lato PC) | 214 | 209.993 |
| PC → server, WebSocket `/wisp/` (lato server) | 155 | 207.721 |
| nginx → container Wisp (loopback) | 118 | 204.814 |
| server → Wikipedia (eth0) | 182 | 204.016 |
| Chrome Collegati, download app | 4.834 | 4.950.021 |
| Chrome Condividi, download app | 2.120 | 2.464.166 |

## Chi può vedere cosa

| Osservatore | IP del PC di casa | Siti visitati (nome host) | URL e contenuti HTTPS |
|---|---|---|---|
| Rete locale / provider di casa | sì | **no** (vede solo transfer.wayfold.xyz) | no |
| PC che condivide | n/a | sì (CONNECT Wisp) | no |
| Server WayFold (nginx + Wisp) | sì (X-Real-IP) | sì (CONNECT + SNI) | no |
| DNS Hetzner | no | sì | no |
| Sito visitato (Wikipedia) | **no**, vede 167.233.121.159 | n/a | sì (è il destinatario) |
| Google (Fonts) | sì | no | no, ma riceve il Referer dell'app |

## Rilievi e raccomandazioni

1. **Risolto (release 20261121233301): il PC che naviga doveva scaricare l'app online.** Nel test ha scaricato 4,95 MB da `transfer.wayfold.xyz`, comprese `/browse/`, i file Ultraviolet e `proxy-transport` (1,7 MB), che all'epoca erano esclusi dal precache. Ora:
   - il precache include tutta la navigazione (4,2 MB in totale);
   - il service worker di Ultraviolet viene registrato alla prima apertura online e serve i propri script dalla cache;
   - il pacchetto offline espone l'uscita Wisp sul PC che condivide.

   Verifica in rete chiusa simulata: il dispositivo che naviga era senza rete e con il server dell'app spento, e ha aperto `http://192.168.1.101:9099/` (intranet) in 1,2 s e `https://example.com/` in 1,6 s. Dalla LAN, l'uscita risponde 403.
2. **Risolto nel pacchetto offline: siti interni con certificato autofirmato o di una CA aziendale.** La libreria TLS del proxy rifiutava questi certificati (`UnknownIssuer`). Solo la build del pacchetto offline inoltra l'opzione che accetta qualunque certificato, e solo quando la pagina è servita da `http://localhost` o `http://127.0.0.1`. Su `transfer.wayfold.xyz` la verifica resta attiva: lo stesso sito di prova è stato rifiutato. Verifica con un server TLS 1.3 e certificato autofirmato, dispositivo che naviga senza rete: `https://127.0.0.1:9443/` caricata in 2,0 s.
3. **Siti `http://` senza TLS:** il TLS interno esiste solo per i siti HTTPS. Per un sito in HTTP semplice il PC che condivide e il server Wisp vedrebbero URL e contenuti in chiaro. Raccomandazione: avviso nella barra di navigazione, o blocco della porta 80.
4. **Google Fonts:** le pagine dell'app caricano font da `fonts.googleapis.com`. Google riceve l'IP del PC e il Referer. Sul PC che naviga i font falliscono, perché non ha DNS. Raccomandazione: servire i font dal dominio WayFold.
5. **Metadati visibili al server:** IP pubblico, User-Agent, nomi host, tempi e volumi. È inevitabile con un'uscita tramite proxy. Va dichiarato nell'informativa privacy, insieme al DNS Hetzner.
6. **Tratta interna nginx → Wisp in chiaro:** resta confinata a loopback e bridge Docker, e i contenuti HTTPS sono comunque protetti dal TLS interno. Non richiede interventi.

## File allegati (`pcap/`, esclusa da git)

| File | Contenuto |
|---|---|
| `client-test-filtered.pcapng` | cattura del PC filtrata sulle sessioni del test e sul DNS rilevante |
| `client-wifi-raw.pcapng` | cattura grezza completa del PC (contiene anche traffico di altre applicazioni) |
| `server-test-filtered.pcapng` | cattura del server filtrata su IP di casa, porta 7900, Wikipedia e DNS wiki |
| `keys-share.log`, `keys-join.log`, `keys-all.log` | chiavi TLS delle sole sessioni dei due Chrome di test |
| `sockets.csv` | connessioni per processo durante il test |
| `tls-attribution.json` | sessione TLS → Chrome |
| `wisp-decoded.json` | decodifica del protocollo Wisp |
| `timeline.json`, `e2e.log` | eventi e log del test |
| `screenshot-browse.png`, `screenshot-net-join.png` | stato finale delle due finestre |

### Riprodurre l'analisi in Wireshark

1. Apri `client-test-filtered.pcapng`.
2. In *Preferenze → Protocols → TLS → (Pre)-Master-Secret log filename* seleziona `keys-all.log`.
3. Usa questi filtri:
   - `tcp.port == 2549 && websocket`: il tunnel di navigazione. I frame binari iniziano con il tipo Wisp: `01` CONNECT, `02` DATA, `03` CONTINUE, `04` CLOSE.
   - `http2.headers.path`: le richieste dell'app decifrate.
   - `dns.qry.name contains "wiki"`: nessun risultato sul PC.
4. Sul server apri `server-test-filtered.pcapng` e usa `tls.handshake.extensions_server_name contains "wiki"` per vedere l'uscita verso Wikipedia da 167.233.121.159.
