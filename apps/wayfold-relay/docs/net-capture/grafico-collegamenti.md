# WayFold Rete: grafico dei collegamenti

Cattura del 21/11/2026, 22:58:55–22:59:24 UTC. Navigazione di prova: `https://en.m.wikipedia.org/wiki/QR_code` dal PC che naviga, tramite il collegamento ottico verso il PC che condivide. Dettagli e prove in [report.md](report.md).

Nel disegno l'azzurro è la luce fra i due schermi. La linea nera è il cavo, e parte solo dal PC che condivide. La stessa slide è in [collegamento-luce.pptx](collegamento-luce.pptx).

## Percorso dei dati

![La pagina passa nell'aria: QR fra i due PC, il cavo solo dopo](collegamento-luce.png)

Tra i due PC non c'è un pacchetto di rete: i frame WFL1 passano solo dai QR. Il TLS verso Wikipedia resta cifrato fino al PC che naviga; nginx e il container vedono l'host di destinazione e il volume, non la pagina.

## Traffico che non è la pagina

```mermaid
flowchart LR
  RN["PC che naviga"]
  RC["PC che condivide"]
  R["Router di casa"]
  DNS["DNS Hetzner<br/>185.12.64.1 / .2"]
  WS["wayfold-wisp"]
  GOO["Google<br/>account, gstatic, font"]
  WIKI["Wikipedia"]

  RN -.->|"download dell'app<br/>HTTPS, 4,95 MB"| R
  RC -.->|"download dell'app<br/>HTTPS, 2,46 MB"| R
  RC -.->|"Chrome e Google Fonts"| GOO
  WS -.->|"risoluzione nomi"| DNS
  RN -.->|"fetch diretto<br/>Failed to fetch"| WIKI
```

Il fetch diretto dal PC che naviga verso Wikipedia non è uscito: il browser lo ha chiuso prima di un pacchetto utile. La pagina è passata solo dal tratto spesso del grafico precedente.

## Modalità rete chiusa

Pacchetto offline, test del 21/11/2026 23:27 UTC. Il PC che condivide avvia `Avvia-Relay.bat` e apre `http://localhost:8080/#net`. L'uscita Wisp è sul PC stesso, quindi chi naviga raggiunge ciò che quel PC raggiunge. Nel test il dispositivo che naviga non aveva rete propria.

```mermaid
flowchart LR
  subgraph NAV["Dispositivo che naviga, senza rete"]
    BN["App in cache<br/>/browse/ + Ultraviolet + epoxy"]
  end

  subgraph SHARE["PC che condivide"]
    direction TB
    RC["Pagina Rete<br/>localhost:8080/#net"]
    SV["Server offline<br/>/wisp/ solo da 127.0.0.1"]
    RC -->|"ws://localhost:8080/wisp/"| SV
  end

  INTRA["Intranet<br/>anche con certificato aziendale<br/>HTTP 1,2 s · HTTPS 2,0 s"]
  NET["Internet, se il PC ce l'ha<br/>example.com in 1,6 s"]
  LAN["Altri dispositivi della LAN"]

  BN ==>|"QR, WFL1 cifrato"| RC
  SV ==>|"TCP dalla rete del PC"| INTRA
  SV ==>|"TCP dalla rete del PC"| NET
  LAN -.->|"GET /wisp/ su :8443<br/>risposta 403"| SV
```

## Strati di cifratura

```mermaid
flowchart LR
  A["Browser del PC che naviga"]
  B["Frame Wisp DATA"]
  C["Pagina Rete del PC che condivide"]
  D["nginx"]
  E["wisp-js"]
  F["Wikipedia"]

  A -->|"TLS 1.3, integro fino a Wikipedia"| B
  B -->|"WFL1 AES-GCM, sui QR"| C
  C -->|"WSS verso nginx"| D
  D -->|"WebSocket in chiaro, solo nel server"| E
  E -->|"TCP: dentro c'è ancora il TLS"| F
```

## Sequenza

Orari in UTC. Partecipanti da sinistra a destra, nell'ordine in cui i byte si muovono.

```mermaid
sequenceDiagram
  autonumber
  participant N as PC che naviga
  participant C as PC che condivide
  participant S as Hetzner
  participant W as Wikipedia

  Note over N,C: 22:58:56–22:59:03 download dell'app da transfer.wayfold.xyz
  N--x W: 22:59:03 fetch diretto, bloccato
  N->>C: 22:59:03–07 abbinamento QR, codice 827638
  C->>N: 22:59:07 autorizzato, entrambi Collegato
  Note over N: 22:59:10 avvio navigazione
  C->>S: 22:59:11 WebSocket /wisp/
  N->>C: CONNECT en.m.wikipedia.org:443
  C->>S: inoltro dello stream Wisp
  S->>W: 22:59:11 DNS e SYN da 167.233.121.159
  N->>W: ClientHello con SNI, dentro il tunnel
  C->>S: 22:59:13 CONNECT en.wikipedia.org:443
  C->>S: 22:59:22 CONNECT thumb.wikimedia.org:443
  Note over N: 22:59:22 pagina caricata, 12,4 s
```
