# IronFit

Tréningová webová aplikácia pre fitko **Iron University SK** (Bratislavská 2a, Nitra). Statická stránka bez servera a bez buildu, beží na GitHub Pages a funguje aj offline (PWA).

## Funkcie

- **Stroje a cviky:** vyše 50 cvikov podľa vybavenia fitka. Každý má animáciu pohybu (play/pauza a posuvník fázy), nastavenie stroja, postup, časté chyby, tipy a zapojené svaly.
- **Automatický plán:** podľa cieľa (sila / objem / kondícia), počtu dní (2–6), skúseností a dĺžky tréningu. Rozdelenie: celé telo → horná/spodná → PPL. Cvik vymeníš jedným ťukom.
- **Progres:** dvojitá progresia (keď dáš horný počet opakovaní vo všetkých sériách, pridá sa váha). Pri stagnácii sa váha zníži o 10 %, každý 6. týždeň je deload.
- **Regenerácia:** odhad únavy svalov z posledných 72 h. Ak sú svaly na plánovaný deň ešte unavené, aplikácia navrhne iný deň.
- **Záznam tréningu:** predvyplnené váhy, časovač pauzy so zvukom a vibráciou, kalkulačka kotúčov a obrazovka nezhasne počas tréningu.
- **Rekordy (PR):** najvyššia váha, odhad 1RM (Epley), najviac opakovaní a objem. Nový rekord sa ohlási hneď počas tréningu.
- **Pokrok:** kalendár tréningov, počet sérií na sval za týždeň (cieľ 10–20) a graf 1RM pre každý cvik.
- **Dáta:** ukladajú sa len v prehliadači (localStorage). Zálohu stiahneš a obnovíš ako JSON.

## Vývoj

```bash
npx serve .            # alebo akýkoľvek statický server
node --test tests/     # unit testy logiky (plánovač, štatistiky, integrita dát)
```

`tools/preview.html?ids=leg-press,bench-press` zobrazí animácie vybraných cvikov vo fázach 0 / 0,5 / 1.

Štruktúra:

- `js/app.js`: router a obrazovky
- `js/planner.js`: generovanie plánu a progresia
- `js/stats.js`: 1RM, rekordy, únava svalov a kotúče
- `js/anim.js`: animácie postavy (forward kinematics v SVG)
- `js/data/`: databáza cvikov

Rady v aplikácii nenahrádzajú trénera ani lekára.
