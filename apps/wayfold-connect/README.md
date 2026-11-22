# Wayfold Connect (PoC)

Navigazione web completa tra due PC su un **link ottico bidirezionale**: ogni PC mostra QR animati su uno schermo e legge con una webcam i QR dell'altro. Il PC *gateway* ha Internet, il PC *client* naviga attraverso di lui con un browser normale configurato su un proxy SOCKS5 locale.

Proof of concept da laboratorio, non un prodotto: niente VPN, niente driver, solo TCP (HTTP/HTTPS).

```
 PC CLIENT                                          PC GATEWAY
 browser --SOCKS5--> helper client                  helper gateway --TCP--> Internet
                        |  WebSocket                   |  WebSocket
                    pagina modem                   pagina modem
            monitor QR ------- uplink ottico -------> webcam
               webcam <------ downlink ottico ------- monitor QR
```

## Hardware

- **Due webcam, una per verso.** Con una sola webcam il link va in un solo verso, cioè la modalità Diode di Wayfold Relay.
- **Client:** un monitor (o mezzo schermo) per i QR, l'altro per navigare; una webcam puntata sul monitor QR del gateway.
- **Gateway:** un monitor o una finestra per i QR; una webcam puntata sul monitor QR del client.
- Per webcam e QR conviene la stanza illuminata ma niente riflessi sul monitor. Inquadratura: il QR deve occupare buona parte del fotogramma.

## Installazione (su entrambi i PC)

```powershell
cd apps/wayfold-relay;   npm install; npm run build   # pagina modem (dist/modem)
cd ../wayfold-connect;   npm install
```

Serve Node 22.18 o più recente (esegue TypeScript direttamente).

## Avvio

**Gateway** (PC con Internet):

```powershell
npm run gateway                       # oppure: node src/cli.ts gateway --name "Lab-GW"
```

**Client**:

```powershell
npm run client                        # SOCKS5 127.0.0.1:1080, HTTP 127.0.0.1:8080
```

Ogni helper stampa due indirizzi:

- **Pannello** `http://127.0.0.1:7701/` (gateway) o `:7702/` (client): stato, codice di verifica, autorizzazione, metriche, connessioni ed eventi.
- **Pagina modem**, da aprire in una finestra separata del browser, da spostare sul monitor QR e mettere a tutto schermo con "Schermo intero QR":
  - produzione: `https://transfer.wayfold.xyz/modem/` (campo "Helper": `ws://127.0.0.1:7701/modem-ws` sul gateway, `ws://127.0.0.1:7702/modem-ws` sul client). Chrome può chiedere il permesso di accedere ai dispositivi della rete locale: va concesso, perché la pagina parla con l'helper su `127.0.0.1`;
  - offline: `http://127.0.0.1:7701/modem/` o `:7702/modem/` (richiede `npm run build` in wayfold-relay).

La finestra modem deve restare **visibile**. Se è ridotta a icona o in una scheda di background, il browser sospende animazione e webcam e il link si ferma.

## Procedura

1. **Misura prima la velocità.** Su entrambe le pagine modem scegli "Modalità: Test velocità", quindi premi Avvia. Ogni lato vede i "QR letti nuovi/s", i KB/s e la perdita del verso che riceve. Regola inquadratura, distanza, "QR", "Byte/QR" e "fps" finché la perdita resta sotto il 10-20%. Punti di partenza:

   | Situazione | QR | Byte/QR | fps |
   |---|---|---|---|
   | Webcam 720p o distanza > 1 m | 1 | 900 | 12 |
   | Webcam 1080p, monitor vicino | 2 | 1200 | 15 |
   | Webcam 1080p ben inquadrata | 4 | 1500-1850 | 20-24 |

   Più QR e più byte per QR significano moduli più piccoli, quindi servono più risoluzione e più messa a fuoco. Gli fps oltre quelli reali della webcam non servono.
2. Riporta le pagine in "Modalità: Link (helper)".
3. **Abbinamento.** Il client legge l'offerta del gateway e invia la sua richiesta. Sul pannello del gateway compaiono nome, impronta e codice a 6 cifre, lo stesso mostrato sul client. Confronta il codice e premi **Autorizza** (oppure **Rifiuta**).
4. **Naviga dal client** con un profilo Chrome dedicato:

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\wayfold-connect" --proxy-server="socks5://127.0.0.1:1080"
   ```

   Con il proxy SOCKS5 anche i nomi DNS vengono risolti dal gateway. Firefox: proxy manuale SOCKS v5 `127.0.0.1:1080` con "DNS tramite proxy SOCKS v5". Per `curl`: `curl -x socks5h://127.0.0.1:1080 https://example.com`.
5. **Disconnessione:** pulsante "Disconnetti" su uno dei due pannelli. Il client poi resta "Disconnesso" finché non premi "Riconnetti", e serve una nuova autorizzazione.

## Come funziona

- **Frame WFL1:** un QR contiene un frame (header di 14 byte con linkId e seq), riempito fino alla dimensione fissa scelta nel modem, così la versione QR non cambia.
- **Abbinamento:** il gateway trasmette un'offerta in chiaro con la propria chiave pubblica X25519. Il client risponde con la sua chiave e il suo nome. Le chiavi di sessione si ricavano con HKDF-SHA256, una per verso, e ogni frame è cifrato con AES-256-GCM: nonce = verso + seq, AAD = header. Il codice a 6 cifre deriva da entrambe le chiavi e permette di accorgersi di un dispositivo estraneo.
- **Affidabilità:** ogni frame trasporta un ACK cumulativo, una SACK a 64 bit e l'eco dell'ultimo seq ricevuto (per l'RTT). Le perdite si rilevano con il RACK o con il timeout di ritrasmissione. I frame liberi ripetono i segmenti non ancora confermati.
- **Multiplex:** più connessioni TCP viaggiano sullo stesso link (`OPEN`, `DATA`, `END`, `RESET`) servite a turno, con backpressure verso i socket.
- **Policy del gateway** (opzioni di avvio):
  - `--allow` / `--deny`: domini per suffisso;
  - `--ports`: default 80 e 443;
  - LAN, loopback e indirizzi privati bloccati di default (`--allow-private` per consentirli), controllati anche dopo la risoluzione DNS;
  - `--max-streams`: connessioni contemporanee.
- **Timer:**
  - link considerato interrotto dopo 2,5 s senza frame validi;
  - connessioni aperte chiuse dopo 30 s (la sessione resta);
  - sessione chiusa dopo 5 min senza segnale;
  - inattività `--idle` (default 15 min) e durata massima `--max-session` (default 120 min).

## Prove senza webcam

- `npm test`: protocollo, crittografia, ARQ, mux, policy; abbinamento, rifiuto, trasferimento bidirezionale con perdite, duplicati e un'interruzione di 4 s; disconnessione e inattività. Tutto su un link simulato.
- `npm run sim -- --loss 0.15 --fps 24 --grid 2 --mtu 1400`: gateway e client nello stesso processo con un canale ottico simulato e i proxy reali. Poi `curl -x socks5h://127.0.0.1:1080 https://example.com`.
- **Banco ottico su un solo PC:** avvia `npm run gateway` e `npm run client`, poi apri `http://127.0.0.1:7701/modem/?dual=1`. Due modem nella stessa scheda, ciascuno "vede" il canvas dell'altro: QR veri e decodifica zxing vera, solo la fotocamera è sostituita.

Misure sul banco ottico (loopback, nessuna webcam): 2 QR × 1200 B × 15 fps danno circa 28 KB/s di dati utili; 4 QR × 1850 B × 24 fps circa 150 KB/s (1 MB in 6,7 s). Con webcam reali i valori dipendono dall'inquadratura: misurali con la modalità Test.

## Limiti noti

- Solo TCP tramite proxy: niente UDP o QUIC (i browser ripiegano su TCP), niente app che non supportano proxy.
- Un client alla volta per gateway.
- Le chiavi sono effimere: ogni riavvio dell'helper richiede un nuovo abbinamento.
- La pagina modem deve restare in primo piano o almeno visibile.
