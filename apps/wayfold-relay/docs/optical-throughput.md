# Optical throughput experiments

Protocollo QR + fountain invariato. Ogni ottimizzazione è un flag spento di default; i numeri entrano qui solo dopo un benchmark eseguito.

Attivazione: `?wfopt=perf` (o `localStorage.wf-opt`). Token aggiuntivi: `roi`, `mem`, `fast`, `latest`, `native`, `budget:0.5|1|1.5|2`, `sched:latest|pool`, `exp`, `exp:short`.

## Unità

`kB/s` = byte/s ÷ 1000. `KiB/s` = byte/s ÷ 1024. I campi JSON `opticalBps`, `fountainBps` e `fileBps` sono byte al secondo, senza prefisso. La HUD li mostra in KiB/s. Il modello in `bench/results/model.json` riporta entrambe le colonne (`fountainKBps`, `fountainKiBps`).

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
| Ricostruiti | Crescita di `solvedCount * blockLen`, in byte/s (HUD: KiB/s) |

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

Nel JSON: `fps.negotiated` contro `fps.observed` e `fps.processed`; `samples` con fase `extract` (copia pixel), `queue` (attesa prima del decode), `wasm` (solo il decode, da `startedAt`), `aggregate` (chiusura del batch ROI); `passes` / `skippedPasses`; `grabs` (pixel letti, job, frame interi); `exposure`; `goodput.opticalBps` contro `goodput.fountainBps` in byte/s; `windows`; `busyWorkers`.

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

A 24 FPS e 1830 byte utili per QR, `4 × 1830 × 24` fa 175.7 kB/s (171.6 KiB/s). Il 70% di quel tetto, per perdite, duplicati e ridondanza, è 123.0 kB/s. Non è una misura. Il goodput dichiarato della pipeline attuale, prima di questi flag, è circa 40 kB/s e non è stato rimisurato in questa sessione. Quattro QR simultanei raggiungerebbero 100 kB/s intorno al 57% di efficienza solo se la fotocamera risolve tutti i simboli a quella densità.

## Screening sintetico

Eseguito `node --experimental-strip-types bench/decode-bench.mjs screen` su Node 24, i7-12650H (16 thread). Frame puliti disegnati in memoria, decode legacy, due semi per cella. Non è una misura di fotocamera. I default di trasmissione restano 24 FPS, 1850 byte, ECC L, camera 1280, 2 worker.

Il prodotto completo è 13440 combinazioni. Lo screening ne ha decodificate 240 (payload × ECC × griglia × larghezza camera) e il modello ne ha valutate 9296 scartando i decode a successo zero. Il filtro di sopravvivenza chiede successo ≥ 95% e zero byte sbagliati: è più stretto del criterio di accettazione del prodotto, dove il fountain può assorbire simboli persi.

Sulla cella di default (1850 byte, ECC L, 1 QR, camera 1280) il decode mediano è 15.2 ms e il modello, a 24 FPS di trasmissione e 30 FPS di camera con 2 worker, dà **43.9 kB/s (42.9 KiB/s)** di goodput fountain. È il tetto del modello a perdita zero, vicino ai 40 kB/s dichiarati per la pipeline attuale.

La stessa cella a 4 QR resta a successo 100% in 15.0 ms. Due worker bastano, su questo PC e su questi frame puliti, a stare dietro a una camera da 30 FPS. Il tetto del modello a 24 FPS e perdita zero è 175.7 kB/s (171.6 KiB/s). Resta da vedere se la fotocamera risolve quei quattro simboli: è il punto dei sei test in camera.

Configurazioni che su frame puliti non decodificano (successo 0), quindi da non inseguire senza un altro render:

- 1850 byte, ECC L, 4 QR, camera 960
- 1850 byte, ECC M, 3 QR, camera 1280
- 2331 byte, ECC L, 3 QR, camera 1280
- diversi 4 QR a 960 px sopra i 1200 byte

Il modello, senza perdite, mette in cima 2900 byte, ECC L, 4 QR, 60 FPS: 691.2 kB/s (675 KiB/s). È il prodotto `txFps × griglia × payload utile` quando ogni simbolo arriva una volta. Non è un goodput atteso in camera e non cambia i default.

Su 165 celle pulite a 30 FPS di camera, 159 sono già sature con 2 worker (il decode sta sotto i 67 ms). Le 6 in cui 4 worker alzano il tetto sono tutte a camera 2560 e guadagnano pochi decode al secondo (da circa 26–29 a 30). Non è un motivo per cambiare il default di 2 worker sul frame intero. Il caso in cui 4 worker contano è la ROI parallela, sotto.

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

## Acquisizione ottica

Il decode sintetico ha margine. Questi esperimenti non toccano protocollo, fountain, formato dei pacchetti, né i default (24 FPS, 1850 byte, ECC L, camera 1280, 2 worker). Nessun altro profilo di decode è stato aggiunto.

### Moduli interi

Transfer, Diode e il modem scalano già con `Math.floor` e `imageSmoothingEnabled = false`: un modulo occupa un numero intero di pixel del canvas. `bench/optics.mjs` mette lo stesso raster nel sensore a 2, 3, 4 e 5 pixel per modulo, senza ricampionamento. Su contrasto pulito, 800 / 1200 / 1850 / 2331 byte a 1, 2 e 4 QR decodificano al 100% ogni volta che la griglia entra in 1280×960. A 2.5 pixel per modulo il campionamento lineare e quello nearest, su 1850 byte, sono entrambi al 100%: l’interpolazione non è il guasto, su questi frame.

Non entrano nel fotogramma 1280×960, quindi non hanno un decode: 1850 byte a 4 QR oltre 3 px/modulo, 2331 byte a 4 QR oltre 2 px/modulo, 2331 byte a 2 QR oltre 3 px/modulo. Nello screening con proiezione prospettica (non a moduli interi) la stessa camera 1280 vede i 4 QR da 1850 byte a circa 2.11 px/modulo e li legge comunque, da puliti. Il margine che manca è quello che sopravvive a blur e movimento, non il decode del frame perfetto.

### Motion blur e frame misti

Sempre 1850 byte, 4 px/modulo, frame intero:

| Disturbo | Successo | Tempo |
|---|---:|---:|
| Smear orizzontale 2 px | 100% | 16 ms |
| Smear orizzontale 6 px | 0% | 65 ms |
| Blend 50/50 di due simboli | 0% | 72 ms |
| Rolling shutter a metà tra due simboli | 0% | 74 ms |

Uno smear di 6 px è un modulo e mezzo di scia: il simbolo non si legge. Un fotogramma che integra due QR diversi non si legge neanche per metà. Il tempo di posa va tenuto sotto la durata del simbolo (a 24 FPS il simbolo resta circa 42 ms) e, se il dispositivo lo permette, molto sotto. È il motivo del flag di esposizione, non di un altro decoder.

### Esposizione

`exp` chiede `exposureMode: continuous` se le capability lo elencano. `exp:short` chiede un tempo di posa di al più 8 ms (1/125 s), agganciato al minimo del dispositivo se non può arrivare così in basso, e `exposureMode: manual` solo se quel modo esiste. Il vincolo viaggia nello stesso `applyConstraints` del fuoco, così un tentativo non cancella l’altro. Se il device rifiuta la posa corta, resta il fuoco. Spento di default: senza JSON di un telefono non c’è un prima/dopo. La HUD e il campo `exposure` del JSON riportano modo, tempo e se il vincolo è rimasto attaccato.

### Payload a camera 1280, ECC L, proiezione dello screening

| Byte | 1 QR | 2 QR | 4 QR |
|---|---|---|---|
| 800 | 6.40 px/mod, 12.7 ms, 100% | 6.40 px/mod, 14.5 ms, 100% | 3.08 px/mod, 11.6 ms, 100% |
| 1200 | 5.38 px/mod, 13.6 ms, 100% | 5.38 px/mod, 15.6 ms, 100% | 2.58 px/mod, 13.4 ms, 100% |
| 1850 | 4.39 px/mod, 15.2 ms, 100% | 4.39 px/mod, 20.4 ms, 100% | 2.11 px/mod, 15.0 ms, 100% |
| 2331 | 3.98 px/mod, 24.1 ms, 100% | 3.98 px/mod, 28.1 ms, 100% | 1.91 px/mod, 19.1 ms, 100% |

Quattro QR da 2331 byte stanno a meno di 2 pixel per modulo già nel render pulito. È il candidato più fragile appena la foto si sporca. I default non si spostano finché un JSON reale non lo conferma.

### Pipeline ROI concorrente, 4 QR da 1850 byte a 3 px/modulo

Copia dei pixel in Node, non un `getImageData` di telefono. `slowest` è il tempo di parete se ogni job ha un worker.

| Worker liberi | Pixel copiati | Estrazione | Decode più lento |
|---|---:|---:|---:|
| Frame intero | 1.23 Mpx | 1.4 ms | 16.8 ms |
| 1 (unione) | 0.89 Mpx | 1.4 ms | 15.0 ms |
| 2 (due fasce) | 0.85 Mpx | 1.8 ms | 9.5 ms |
| 4 (un QR ciascuno) | 0.81 Mpx | 0.6 ms | 4.2 ms |

I quattro simboli riempiono quasi il fotogramma, quindi il risparmio di pixel è modesto. Il tempo che scende è il decode in parallelo. Sul telefono la voce da leggere nel JSON è `samples` fase `extract`: lì la copia da 5 MB può pesare più di questo 1 ms. Con `roi`, 2 o 3 worker liberi su 4 QR non lasciano più uno slot fermo: i riquadri si dividono in fasce, ognuna un’unione. Prima, meno worker dei QR significava una sola unione.

### Optical Link Calibration, non collegata

`receive/link-calibration.ts` calcola i pixel per modulo dal quad e confronta il risultato con l’ipotesi di 3 px/modulo (`low` / `ok` / `wide`). Nessun controller la chiama. La procedura futura, quando ci saranno i JSON:

1. Il mittente tiene fermo un simbolo già previsto dal protocollo (come fa il video).
2. Il ricevitore legge dal JSON quad, `exposure.timeS`, nitidezza, FPS osservati e `grabs`.
3. Il consiglio resta a schermo. Non cambia FPS, payload né ECC.
4. La soglia di 3 px/modulo si tiene o si butta solo dopo quelle misure.

File: `bench/results/optics.json`. Camera reale: **non misurato**.

## Priorità ancora aperte

1. Leggere i JSON dei sei test, più `?wfopt=perf,exp` e `?wfopt=perf,exp:short` sullo stesso telefono.
2. Latest Frame Only solo se `queue` nei JSON mostra worker fermi in attesa.
3. BarcodeDetector resta rimandato: `rawValue` è una stringa.

Nessun default cambia senza un prima/dopo di camera. Nessun altro intervento sul decoder prima di quei JSON.
