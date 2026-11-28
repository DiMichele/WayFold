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

I quattro angoli non sono gli angoli del bounding box. Il localizzatore prende il contorno scuro, il guscio convesso, i quattro spigoli e l'intersezione delle rette dei lati. Lo spessore del bordo, e quindi i pixel per modulo, è la mediana della corsa scura lungo la normale di ciascun lato, sulla luminanza, non su una soglia del solo rosso. L'omografia manda gli angoli esterni del modulo `(0,0)…(span,span)` su quelle intersezioni. La tacca bianca sceglie quale lato è il sopra.

La separazione campiona il centro di ogni modulo, oppure un 3×3 interno al modulo. I tre metodi sono affine (matrice 3×3 più offset, con numero di condizione e residuo), classificazione sul colore più vicino, e ibrido (affine e poi classificazione). Il percorso attivo è l'ibrido con campionamento sul centro. Il Mono non chiama nessuna di queste funzioni.

## Modalità

- Transfer: ogni canale è un frame fountain con `seq` proprio. Griglie 1, 2 e 4.
- Diode: file e chat consumano N frame fountain per paint, nello stesso ordine del carousel. Il video Mono continua a ripetere il simbolo di `seq` 0, così il fermo-immagine non cambia. Il video a colori mette su ogni canale un `seq` fountain distinto della stessa sessione. Codec, bitrate, risoluzione e contenitore non cambiano. Il ricevitore non dipinge e non c'è ACK.
- Optical Network: ogni canale è un'unità già prodotta da `pull`, come una cella della griglia. Si usano solo le griglie 1, 2 e 4. `OPTICAL_INFLIGHT` resta 12. Un canale perso è un frame ottico perso: l'ARQ esistente lo ritrasmette e riconsegna in ordine. Il tetto teorico `12 × MTU × 8 / RTT` è una formula, non una misura di link.

Il crop della camera resta quello di prima quando il profilo è Mono. A colori, il fotogramma intero si legge finché la cornice non è stata vista, poi ogni 12 catture, e anche quando il numero di cornici trovate scende sotto quello già visto. Il rettangolo della cattura successiva è l'unione di tutte le cornici localizzate, comprese quelle non separate in quel frame. Geometria localizzata, compositi separati e simboli schedulati sono tre conteggi distinti nella HUD.

## Scheduling

Una cattura non tiene una coda fra un frame e il successivo. RGB 3 con quattro compositi offre 12 canali.

| Modalità | Cosa fa un worker | Con 2 worker e 12 canali |
|---|---|---|
| `channel` | un simbolo | ne elabora 2 e ne lascia 10 |
| `composite` | un simbolo, ordinato per composito | ne elabora 2 e ne lascia 10 |
| `cell` | tutti i canali di un composito | ne elabora 6 (due compositi) |
| `adaptive` | quanti ne servono, senza tetto di tempo | ne elabora 12, 6 per worker |
| `budget` | come `adaptive`, finché il job più lento sta nel periodo del frame | dipende dal tempo misurato |

Il percorso attivo è `budget`. Il periodo è quello della camera (o 30 fps finché non c'è una misura) moltiplicato per il flag `budget` già esistente, che resta 1. Il costo di un simbolo parte da 12 ms e diventa il tempo reale del job diviso i simboli di quel job. La separazione sul thread principale si ferma allo stesso periodo: il primo composito viene sempre separato, i successivi solo se avanza tempo, e il frame dopo parte da un altro composito. Non si aggiungono worker. `channel` e `composite` restano solo il confronto: sono loro a tagliare i canali al numero di worker liberi.

## Rotazione

Il modem cromatico usa la stessa trasformazione di canvas del percorso Mono, a 90°, 180° e 270°. La ROI è espressa nell'immagine già ruotata. La lettura scrive solo il rettangolo della ROI: non c'è una seconda copia `ImageData` dell'intero fotogramma quando la cornice è già nota. Il primo fotogramma, senza ROI, legge ancora l'immagine intera. Mono non passa da questa funzione.

## HUD

Con `?wfopt=perf` la HUD e il JSON della sessione riportano, quando il profilo non è Mono: profilo, griglia, canali, candidati, schedulati, scartati, decodificati, goodput ottico già presente nelle righe sopra, saturazione (`none`, `budget`, `slots`, `pool`), qualità cromatica, localizzazione, calibrazione, separazione, decode, residuo e numero di condizione. `pool` significa che il frame non è stato analizzato perché nessun worker era libero. `budget` significa che il tempo del frame non bastava. Non sono la saturazione ARQ: quella resta `in volo`, ritrasmissioni e duplicati.

## Benchmark sintetici

`bench/color-bench.mjs` scrive `bench/results/color.json`. Sono raster generati in memoria, non una misura di monitor o fotocamera. Sui frame puliti a 4 pixel per modulo, Color 2 e RGB 3 hanno BER 0 su ogni canale, con i tre metodi e con entrambi i campionamenti. Il mix lineare usato per le palette non le distingue: il rosso/blu resta la palette di Color 2 perché è la prima a parità di BER, non perché una prova fisica l'abbia scelta. Lo sbiancamento dei soli moduli rossi alza il BER del canale rosso e lascia il blu a zero. L'overhead della cornice è la frazione di moduli che non appartiene alla cella QR.

`bench/color-load-bench.mjs` scrive `bench/results/color-load.json`. Confronta 48, 400, 800, 1200, 1850 e 2331 byte solo sulle coppie payload/ECC che un QR può contenere, sulle griglie 1, 2 e 4 (sopra 800 byte solo la griglia 1). Mono, Color 2 e RGB 3 sono portati alla stessa superficie esterna, cornice compresa. Il prodotto `canali × byte × successo × griglia × 10` in quel file è una capacità nominale a 10 compositi al secondo, non un goodput misurato.

`bench/color-profile.mjs` scrive `bench/results/color-profile.json`. ZXing ricostruisce i byte di RGB 3 a 48, 400, 800, 1200, 1850 e 2331 byte. Il tempo di decode è il muro di worker Node reali, 2 e 4, non una stima `simboli × costo medio`. Il goodput ottico di quel file è i byte decodificati diviso quel muro. Il goodput fountain è assente: il payload del banco non è un simbolo fountain. Il goodput applicativo è solo nel modello ARQ.

I test `tests/color-arq.test.mjs` usano `ArqSender` e `ArqReceiver` di produzione. La finestra non supera 12. La perdita di un canale produce ritrasmissioni. L'ordine di consegna resta quello dei numeri di segmento. Una coda vuota non inventa segmenti. Il goodput del modello resta entro la formula della finestra. L'osservazione segna la saturazione come `arq` e lascia vuoti BER ottico e limite dei worker: sono tre cause diverse.

## Matrice fisica

Non eseguita: in questa sessione non c'è un monitor e una fotocamera sotto misura. Per ripeterla, aprire la pagina con `?wfopt=perf`, bloccare il profilo all'avvio e copiare il JSON della HUD.

| Caso | Profilo | Griglia | Rotazione | Cosa controllare |
|---|---|---|---|---|
| Default | Mono | 1 | 0 | Nessun campo colore, stesso percorso di prima |
| Color 2 | Color 2 | 1, 2, 4 | 0 | Canali schedulati e scartati, BER non richiesto dalla HUD |
| RGB 3 | RGB 3 | 1, 2, 4 | 0, 90, 180, 270 | Quattro orientamenti, saturazione `budget` o `none` |
| Diode video | Color 2 o RGB 3 | 1 | 0 | Seq diversi nello stesso paint, nessun ritorno |
| Rete | Color 2 | 2 | 0 | In volo ≤ 12, distinto da saturazione worker |

## Limiti

- Nessuna misura con monitor e fotocamera. I numeri sintetici non sono un incremento di goodput reale.
- Se i segmenti offerti superano i 12 in volo, l'ARQ ripete il più vecchio dopo 250 ms anche quando non c'è stata una perdita. È il comportamento attuale del protocollo: non è stato modificato. Nel modello, con andata 80 ms, generazione ACK 30 ms, ritorno 200 ms e paint ogni 66 ms, 6 ripetizioni su 36 unità nuove sono di questo tipo (`prematureRepeats`), `lossRepeats` è 0 e 48 paint non portano nulla perché la finestra è piena e il timer non è ancora scaduto.
- Un keystone del 16% viene localizzato, ma la griglia dei moduli non è ancora abbastanza precisa per un BER basso. Rotazione libera, luce non uniforme e una sfocatura 3×3 a 4 pixel per modulo restano entro il test.
- La localizzazione sul thread principale, per un RGB 3 da 2331 byte a 4 pixel per modulo, costa circa 24 ms; la separazione 15 ms; il disegno dei canali 3 ms. Il decode ZXing degli stessi tre canali è 14 ms con 4 worker. Spostare localizzazione e separazione su un altro worker non accorcia questo percorso: il frame successivo ha bisogno del risultato, e il trasferimento del raster sarebbe una copia in più. Non è stato fatto. La finestra ARQ resta 12.
- Il confronto fra palette, affine e classificazione sui raster puliti non mostra differenze di BER. Il vantaggio dell'affine compare sul residuo di un mix lineare, non su un goodput misurato.
- Il primo fotogramma cromatico ruotato legge ancora l'immagine intera. Il crop arriva dopo la prima cornice trovata.
- L'ultimo paint video a colori, se i simboli rimasti non riempiono un composito, ripete l'ultimo `seq` sui canali vuoti. Il ricevitore lo tratta come duplicato.
- Auto-Tuning e Adaptive Optical Modem non sono implementati.
