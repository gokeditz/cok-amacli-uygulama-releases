# Clawd Club

Clawd'un 3D gece kulübünde dans ettiği tek dosyalık sayfa. `index.html`'i tarayıcıda açman yeterli, internet gerekmez.

## Neler var

- **Ritim oyunu:** Notalar şarkının yapısından üretilir. Ok tuşları / `D F J K` ya da dokunarak vurulur. Perfect / Great / Good / Miss, kombo çarpanı, 50 kombo sonrası FEVER modu, parça başına rekor. Vuruşların Clawd'a yansır: sol/sağ yumruk, tepinme, zıplama. Kaçırınca tökezler.
- **Kendi şarkın:** Parça menüsünden ses dosyası yükle. Tempo, vuruş fazı, ölçü başı ve drop'lar tarayıcıda analiz edilir; dans, ışıklar, kamera ve oyun notaları şarkıya kilitlenir.
- **İki sentez parça:** *Clawd House* (124 BPM house) ve *Halay Gecesi* (davul + zurna, hicaz makamı). İkisi de Web Audio ile anlık üretilir.
- **13 dans hareketi:** Zıplama, Yengeç, Robot, Shuffle, Headbang, Fırıldak, Dalga, Disko, Halay, Omuz, Moonwalk, Yıldız, Chill. Otomatik modda koreografi şarkının bölümüne göre değişir.
- **Sahne şovu:** Yansıyan LED pist, hareketli spotlar, lazerler, pyro alevleri, CO2, yer sisi, disko topu, LED ekran, konfeti. Mini Clawd'lardan oluşan seyirci break'te telefon ışıklarını yakar.
- **Klip kaydı:** Dansı müziğiyle birlikte video olarak indir (en fazla 60 sn).
- **Kalite ayarı:** Kasma algılanırsa kalite kendiliğinden düşer.

## Kısayollar

| Tuş | İş |
| --- | --- |
| `Boşluk` | Müzik aç/kapa |
| `G` | Ritim oyunu (`Esc` ile çık) |
| `← ↓ ↑ →` / `D F J K` | Oyunda notaya vur |
| `[` `]` | Oyunda gecikme ayarı (±10 ms) |
| `0` / `1–9` | Otomatik koreografi / hareket seç |
| `C` | Serbest kamera |
| `R` | Klip kaydı |
| `Q` | Kalite |
| `H` | Arayüzü gizle (çift tıkla geri gelir) |
| `F` | Tam ekran |
| `↑ ↓` | Tempo (oyun dışında) |

## Geliştirme

```sh
npm install
npm run build   # src/ → index.html
```

`src/` altında: `main.js` (sahne ve döngü), `clawd.js` (iskelet), `moves.js` (dans), `music.js` (ses motoru), `tracks.js` (parçalar), `analysis.js` (şarkı analizi), `game.js` (ritim oyunu), `fx.js` (lazer, pyro, sis), `crowd.js` (seyirci), `recorder.js` (klip), `screen.js` (LED ekran).
