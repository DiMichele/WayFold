# Optical throughput experiments

Protocollo QR + fountain invariato. Ogni ottimizzazione è un flag spento di default; i numeri entrano qui solo dopo un benchmark eseguito.

Attivazione: `?wfopt=perf` (o `localStorage.wf-opt`). Token aggiuntivi: `roi`, `mem`, `fast`, `latest`, `native`, `budget:0.5|1|1.5|2`, `sched:latest|pool`.

## Criteri di accettazione

- Goodput effettivo (fountain / file originale) più alto della baseline sullo stesso scenario.
- Integrità del file finale (FNV + envelope + confronto byte per byte su payload incomprimibili).
- Nessuna regressione di affidabilità sulle tre modalità (Transfer, Diode, Optical Network).
- La perdita di singoli simboli è ammissibile se il fountain la assorbe.
- Un flag non diventa default senza prima/dopo misurato; dopo i bench individuali si prova la combinazione delle migliori.

## Metriche FPS

| Metrica | Significato |
|---|---|
| Configured FPS | Vincolo richiesto a `getUserMedia` |
| Negotiated FPS | `track.getSettings().frameRate` |
| Observed FPS | Delta di `presentedFrames` / `mediaTime` da `requestVideoFrameCallback` |
| Processed FPS | Frame consegnati ai worker |
| Unique QR/s | Simboli con `seq` nuovo |
| Reconstructed kB/s | Crescita di `solvedCount * blockLen` |

L’RTT ARQ (`sender.srtt` / `helper.rttMs`) si misura sul solo mittente tramite ACK. Non richiede orologi sincronizzati. È distinto dalla latenza unidirezionale ottica (coda TX, attesa RX, jitter tra simboli nuovi).

## Baseline (strumentazione)

**File:** `shared/opt-flags.ts`, `shared/opt-trace.ts`, `shared/opt-ui.ts`; wiring in `receive/controller.ts`, `receive/worker.ts`, `diode/rx-controller.ts`, `modem/modem.ts`.

**Motivo:** separare tempi di acquisizione, estrazione, coda, WASM, parse e fountain; distinguere goodput ottico, fountain e file; distinguere FPS richiesti / negoziati / osservati / elaborati; esporre RTT ARQ e attese locali sul modem.

**Beneficio atteso:** poter giudicare ogni ottimizzazione successiva con un prima/dopo confrontabile.

**Benchmark eseguiti:**

- Unit: `node --experimental-strip-types --test tests/opt-flags.test.mjs tests/opt-trace.test.mjs` (vedi sotto).
- Camera reale Transfer / Diode / Optical Network: **non misurato** in questa sessione.

**Regressioni:** con i flag spenti la pipeline di decode è quella precedente (stessi messaggi worker, stessi passaggi ZXing). I campi `postedAt` / `doneAt` sono opzionali.

**Browser:** la HUD `perf` è DOM puro. Observed FPS richiede `requestVideoFrameCallback` con metadati (Chrome sì; Safari/Firefox da verificare sul dispositivo). Heap JS solo dove esiste `performance.memory` (Chrome).

### Risultati unit (baseline)

```
npm test -- tests/opt-flags.test.mjs tests/opt-trace.test.mjs …
29 pass / 0 fail (include optical-flow, protocol, camera-focus esistenti)
npm run typecheck → ok
```

Camera reale: non misurato.

## Fuoco della fotocamera

**File:** `receive/camera.ts`, `receive/sharpness.ts`, `receive/controller.ts`, `diode/rx-controller.ts`, `modem/modem.ts`, i18n, CSS.

**Motivo:** la catena precedente imponeva `focusDistance` ~28 cm e bloccava l’AF al primo QR; senza `focusMode` nelle capability il tap era silenzioso.

**Cosa cambia:** avvio solo `continuous` (zoom lieve se ultra-wide); tap = `single-shot` + `pointsOfInterest` con coda se busy; reticolo; hint se non supportato; niente lock al primo QR; nitidezza (varianza Laplaciano) solo diagnostica con `perf`; AF non segue la ROI in continuo.

**Benchmark eseguiti:** unit `tests/camera-focus.test.mjs` (tap senza distance, manual con distance, letterbox, sharpness sharp≫soft). Camera reale: **non misurato**.

**Regressioni:** nessuna attesa sul protocollo. Su Firefox/Safari l’hint dichiara l’assenza di controllo lente.

## Profilo veloce + budget + ROI (flag `fast`, `roi`, `budget:N`)

**File:** `receive/decode-core.ts`, `receive/worker.ts`, `receive/worker-plan.ts`, `receive/roi.ts`.

**Motivo:** chiudere un frame multi-QR dopo un solo simbolo era prematuro; un budget fisso a 1× periodo camera è troppo rigido con più worker.

**Cosa cambia:** con `fast`, profilo leggero prima; se i simboli sono parziali rispetto al layout noto, solo le ROI mancanti; se zero, profilo duro e crop; il budget (0.5/1/1.5/2 × periodo) si controlla prima di ogni passaggio WASM. Con `roi`, margine adattivo, full-frame periodico, scarto di generazioni vecchie.

**Benchmark eseguiti:** unit `decode-core.test.mjs`, `roi.test.mjs`. Camera reale / goodput: **non misurato**. Flag restano spenti di default.

**Regressioni:** senza flag il worker usa `legacyDecode` (cascata precedente).

## ROI multipla con crop anticipato

**File:** `receive/roi.ts` (`planGrabs`, `RoiSession`); wiring in `receive/controller.ts`, `diode/rx-controller.ts`, `modem/modem.ts`.

**Motivo:** con 2 o 4 QR il frame intero (circa 5 MB a 1280×960) veniva comunque copiato in JS.

**Cosa cambia:** se i worker liberi sono almeno quanti i riquadri, ogni ROI è un `drawImage` della sola sorgente e un `getImageData` di quel ritaglio. Se è libero un solo worker, si legge l’unione dei riquadri, mai il frame intero finché il layout è noto. I ritagli della stessa cattura condividono un id di generazione; i quadrilateri tornano in coordinate camera e il layout si aggiorna solo a batch completo. Sul modem, con rotazione 90/180/270, il frame trasformato resta sul canvas e si legge solo il rettangolo della ROI. Il full-frame resta ogni 15 catture e dopo due miss di un riquadro.

**Benchmark eseguiti:** unit `roi.test.mjs` (4 crop con 4 slot, unione con 1 slot, batch). Pixel letti e goodput in camera: **non misurato**.

**Regressioni:** con `roi` spento `planGrabs` restituisce sempre il frame intero.

## Grayscale (flag `mem`)

**File:** `receive/decode-core.ts` (`rgbaToLuma`, `lumaToPgm`), `receive/worker-plan.ts`.

**Cosa cambia:** con `mem` il worker salta il clone `ImageData` e passa a ZXing un PGM P5 (luminanza Rec.601). Il buffer RGBA inviato al worker resta a 4 byte per pixel; la riduzione riguarda l’immagine che entra nel decoder, non il trasferimento dal thread principale.

**Sonda eseguita** (`node --experimental-strip-types bench/probe.mjs`, zxing-wasm 2.2.4), salvata in `bench/results/probe.json`:

- `imageData`, vista RGBA senza `ImageData`, PGM intero e PGM ritagliato decodificano gli stessi byte del QR sintetico.
- La posizione riportata da ZXing sta entro circa 2 px dal quad disegnato.

**Non misurato:** tempo di conversione, trasferimento e decode rispetto all’RGBA. Il flag resta spento di default.

## Come leggere i sei test in camera

Ogni URL va tenuto abbastanza a lungo da riempire almeno una finestra da 10 s nella HUD, poi si copia il JSON. I numeri di camera reale restano **non misurato** finché quel JSON non esiste.

| Test | Query |
|---|---|
| 1 Baseline | `?wfopt=perf` |
| 2 Fast | `?wfopt=perf,fast` |
| 3 ROI | `?wfopt=perf,roi` |
| 4 Fast + ROI, budget 1.5 | `?wfopt=perf,fast,roi,budget:1.5` |
| 5 Budget aggressivo | `?wfopt=perf,fast,roi,budget:0.5` |
| 6 Budget permissivo | `?wfopt=perf,fast,roi,budget:2` |

Nel JSON: `fps.negotiated` contro `fps.observed`, `fps.processed`, `samples` con fase `wasm` e `extract`, `passes` / `skippedPasses`, `goodput.opticalBps` contro `goodput.fountainBps`, `windows` nel tempo, `busyWorkers`.

| Risultato osservato | Collo di bottiglia probabile |
|---|---|
| Camera negoziata a 30 FPS, osservati 15 | Fotocamera, esposizione o browser |
| Molti frame osservati, pochi elaborati | Saturazione dei worker |
| Tempo WASM elevato | Decodifica ZXing |
| Tempo RGBA (`extract`) elevato | Estrazione e movimentazione dei pixel |
| Molti tentativi di fallback (`passes` oltre il primo, `skippedPasses`) | Qualità ottica o configurazione decoder |
| Molti QR decodificati ma pochi nuovi (`opticalBps` basso a fronte di decodifiche) | Sincronizzazione TX/RX |
| Goodput ottico alto, fountain basso | Ridondanza e ricostruzione |
| Prestazioni che calano in `windows` | Possibile thermal throttling |
| ROI veloce ma pochi simboli (`passes` scarsi, `fountainBps` basso) | Tracking o rilevamento del layout |

## Simulazione, non benchmark

A 24 FPS e circa 1830 byte utili per QR, uno schizzo a efficienza netta 70% (perdite, duplicati, ridondanza) indica circa 123 kB/s di goodput simulato e 176 kB/s di tetto della configurazione. Non è una misura. Il goodput dichiarato dalla pipeline attuale, prima di questi flag, è circa 40 kB/s e non è stato rimisurato in questa sessione. Quattro QR simultanei raggiungerebbero 100 kB/s intorno al 57% di efficienza solo se la fotocamera risolve tutti i simboli a quella densità.

## Screening sintetico

Eseguito `node --experimental-strip-types bench/decode-bench.mjs screen` su Node 24, i7-12650H (16 thread). Frame puliti disegnati in memoria, decode legacy, due semi per cella. Non è una misura di fotocamera. I default di trasmissione restano 24 FPS, 1850 byte, ECC L, camera 1280, 2 worker.

Il prodotto completo è 13440 combinazioni. Lo screening ne ha decodificate 240 (payload × ECC × griglia × larghezza camera) e il modello ne ha valutate 9296 scartando i decode a successo zero. Il filtro di sopravvivenza chiede successo ≥ 95% e zero byte sbagliati: è più stretto del criterio di accettazione del prodotto, dove il fountain può assorbire simboli persi.

Sulla cella di default (1850 byte, ECC L, 1 QR, camera 1280) il decode mediano è 15.2 ms e il modello, a 24 FPS di trasmissione e 30 FPS di camera con 2 worker, dà **42.9 kB/s** di goodput fountain. È il tetto del modello a perdita zero, vicino ai 40 kB/s dichiarati per la pipeline attuale.

La stessa cella a 4 QR resta a successo 100% in 15.0 ms. Due worker bastano, su questo PC e su questi frame puliti, a stare dietro a una camera da 30 FPS. Il tetto del modello a 24 FPS e perdita zero è circa 172 kB/s (4 × 1830 byte × 24 / 1024). Coincide con l’ordine di grandezza del limite teorico citato (176 kB/s). Resta da vedere se la fotocamera risolve quei quattro simboli: è il punto dei sei test in camera.

Configurazioni che su frame puliti non decodificano (successo 0), quindi da non inseguire senza un altro render:

- 1850 byte, ECC L, 4 QR, camera 960
- 1850 byte, ECC M, 3 QR, camera 1280
- 2331 byte, ECC L, 3 QR, camera 1280
- diversi 4 QR a 960 px sopra i 1200 byte

Il modello, senza perdite, mette in cima 2900 byte, ECC L, 4 QR, 60 FPS: 675 kB/s. È il prodotto `txFps × griglia × payload utile` quando ogni simbolo arriva una volta. Non è un goodput atteso in camera e non cambia i default.

Risultati: `bench/results/screen.json`, `bench/results/model.json`.

### Varianti di decode, stessi frame sintetici

`bench/decode-bench.mjs variants`, stesso PC. Mediana su tre frame. `roiSeparate` è la somma sequenziale dei ritagli; `slowestBoxMs` è il ritaglio più lento, cioè il tempo di parete se ogni ritaglio va a un worker libero.

| Caso | legacy | mem | gray | fast | unione ROI | ritagli (somma / più lento) |
|---|---:|---:|---:|---:|---:|---:|
| 1 QR, 1850 B, pulito | 16 ms, 100% | 13 ms, 100% | 14 ms, 100% | 7 ms, 100% | 7 ms, 100% | 6 / 5 ms, 100% |
| 4 QR, 800 B, pulito | 19 ms, 100% | 11 ms, 100% | 12 ms, 100% | 11 ms, 100% | 9 ms, 100% | 14 / 4 ms, 100% |
| 4 QR, 800 B, lontano | 16 ms, 100% | 17 ms, 100% | 16 ms, 100% | 14 ms, 100% | 6 ms, 100% | 7 / 2 ms, 100% |
| 4 QR, 800 B, blur o motion | 85–144 ms, 0% | 58–133 ms, 0% | 45–104 ms, 0% | 73–135 ms, 0% | 44–87 ms, 0% | 46–52 / 15 ms, 0% |

Il grayscale PGM non è più veloce di `mem` su questi frame: la conversione compensa il buffer più piccolo. Il profilo `fast` circa dimezza il tempo sul QR singolo pulito, a parità di successo. I ritagli separati, in parallelo, sono il caso in cui quattro QR puliti scendono verso i 4 ms del riquadro più lento. Dove il legacy non trova nulla (blur e motion sul 4-up), nemmeno ROI e fast recuperano simboli: falliscono prima, e questo è utile solo al budget.

File: `bench/results/variants.json`. Camera reale: **non misurato**.

## Priorità ancora aperte

1. Latest Frame Only (`sched:latest` contro `sched:pool`) se il tempo di inattività dei worker risulta rilevante nei JSON.
2. BarcodeDetector resta sperimentale e rimandato: `rawValue` è una stringa e un solo test positivo non dimostra i payload binari.

## Esperimenti successivi

Combinazione delle migliori dopo i JSON dei sei test. Nessun default cambia senza un prima/dopo di camera.
