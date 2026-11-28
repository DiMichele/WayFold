# WayFold Optical Color Engine

Motore ottico condiviso da Transfer, Optical Diode e Optical Network. Vede solo payload binari. Fountain, envelope, header `0xD1 0x0C`, WFL1 e ARQ non sono stati modificati.

## Profili

| Profilo | Canali | Default |
|---|---|---|
| Mono | 1 QR nero su bianco, percorso precedente | sì |
| Color 2 (sperimentale) | due QR indipendenti, palette rosso/blu | no |
| RGB 3 (sperimentale) | tre QR indipendenti, uno per primario | no |

Il selettore si blocca all'avvio della sessione. Cambiarlo a sessione aperta non ha effetto. Non c'è fallback verso Mono. `bindProfile` restituisce la scelta locale e non scrive nulla sul filo: è il punto in cui un futuro Optical Auto-Tuning potrà negoziare canali, palette, separabilità e costo. Quella negoziazione non è implementata.

Un ricevitore Mono non è compatibile con un composito. I byte dentro ciascun canale sì: sono gli stessi frame di prima. Se il ricevitore cromatico vede un'immagine poco satura, mostra un avviso e non cambia profilo.

## Geometria

Ogni composito ha una cornice fuori dalla quiet zone: un anello nero con una tacca bianca di orientamento, una riga con tutti gli stati della palette (4 per Color 2, 8 per RGB 3) ripetuta in basso, e un modulo bianco di distacco prima della quiet zone. Una sola omografia per composito. I QR sovrapposti condividono versione, ECC, modo byte, maschera 4 e numero di moduli.

La separazione campiona il centro di ogni modulo, oppure un 3×3 interno al modulo. I tre metodi sono affine (matrice 3×3 più offset, con numero di condizione e residuo), classificazione sul colore più vicino, e ibrido (affine e poi classificazione). Il percorso attivo è l'ibrido con campionamento sul centro. Il Mono non chiama nessuna di queste funzioni.

## Modalità

- Transfer: ogni canale è un frame fountain con `seq` proprio. Griglie 1, 2 e 4.
- Diode: file e chat consumano N frame fountain per paint, nello stesso ordine del carousel. Il video continua a ripetere lo stesso simbolo, così il fermo-immagine non cambia semantica. Il ricevitore non dipinge e non c'è ACK.
- Optical Network: ogni canale è un'unità già prodotta da `pull`, come una cella della griglia. Si usano solo le griglie 1, 2 e 4. `OPTICAL_INFLIGHT` resta 12. Un canale perso è un frame ottico perso: l'ARQ esistente lo ritrasmette e riconsegna in ordine. Il tetto teorico `12 × MTU × 8 / RTT` è una formula, non una misura di link.

Il crop della camera resta quello di prima quando il profilo è Mono. A colori, il fotogramma intero si legge solo finché la cornice non è stata vista; poi si ritaglia il composito prima di `getImageData`.

## Benchmark sintetici

`bench/color-bench.mjs` scrive `bench/results/color.json`. Sono raster generati in memoria, non una misura di monitor o fotocamera. Sui frame puliti a 4 pixel per modulo, Color 2 e RGB 3 hanno BER 0 su ogni canale, con i tre metodi e con entrambi i campionamenti. Il mix lineare usato per le palette non le distingue: il rosso/blu resta la palette di Color 2 perché è la prima a parità di BER, non perché una prova fisica l'abbia scelta. Lo sbiancamento dei soli moduli rossi alza il BER del canale rosso e lascia il blu a zero. L'overhead della cornice è la frazione di moduli che non appartiene alla cella QR.

I test `tests/color-arq.test.mjs` usano `ArqSender` e `ArqReceiver` di produzione. La finestra non supera 12. La perdita di un canale produce ritrasmissioni. L'ordine di consegna resta quello dei numeri di segmento. Una coda vuota non inventa segmenti. Il goodput del modello resta entro la formula della finestra.

## Limiti

- Nessuna misura con monitor e fotocamera. Non va letto come un incremento di goodput reale.
- La rotazione del modem (90/180/270) non entra nel percorso colore: con il profilo cromatico il modem legge il sensore solo a rotazione 0.
- Se i segmenti offerti superano i 12 in volo, l'ARQ ripete il più vecchio. Allargare la finestra sarebbe una modifica di ARQ e non è stata fatta.
- Il confronto fra palette, affine e classificazione sui raster puliti non mostra differenze di BER. Il vantaggio dell'affine compare sul residuo di un mix lineare, non su un goodput misurato.
