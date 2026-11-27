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

**File:** `receive/decode-core.ts`, `receive/worker.ts`, `receive/worker-plan.ts`, `receive/roi.ts`; wiring Transfer in `receive/controller.ts`.

**Motivo:** chiudere un frame multi-QR dopo un solo simbolo era prematuro; un budget fisso a 1× periodo camera è troppo rigido con più worker.

**Cosa cambia:** con `fast`, profilo leggero prima; se i simboli sono parziali rispetto al layout noto, solo le ROI mancanti; se zero, profilo duro e crop; il budget (0.5/1/1.5/2 × periodo) si controlla prima di ogni passaggio WASM. Con `roi`, margine adattivo, full-frame periodico, scarto di `frameId` vecchi; con una sola ROI, crop prima di `getImageData`.

**Benchmark eseguiti:** unit `decode-core.test.mjs`, `roi.test.mjs`. Camera reale / goodput: **non misurato**. Flag restano spenti di default.

**Regressioni:** senza flag il worker usa `legacyDecode` (cascata precedente).

## Esperimenti successivi

Memoria/grayscale, Latest Frame (`sched:latest` vs `sched:pool`), screening progressivo, BarcodeDetector corpus, combinazione delle migliori; wiring ROI anche su Diode e modem.
