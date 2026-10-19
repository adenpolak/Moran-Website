# images/

Product photos the site expects, as JPEG, longest side 1600 px, quality 82, progressive
(`python3 scripts/images.py import SOURCE images/NAME.jpg` does the conversion). Nothing in here is generated;
every file is a real photo from the bakery.

| File | What it shows |
| --- | --- |
| number-50-marble.jpg | "50" number cake in a marble-print box: gold almonds, dipped strawberries, Ferrero Rocher, gold stars, gold crown (hero) |
| letter-m-pastel.jpg | letter "M" cream tart, pink/blue/lilac piping, pink Hershey's hearts, Kinder bars |
| number-chocolate.jpg | number cake with Ferrero Rocher, Raffaello, strawberries, macarons, mini Nutella |
| number-pastel-hearts.jpg | pastel number cake, pink Hershey's hearts, Kinder, pearls, gold "Happy Birthday" topper |
| letter-j-rose.jpg | letter "J", pink rose, macarons, pretzels, gold chocolate bars |
| letter-l-crown.jpg | letter "L", gold crown, dragon fruit, Ferrero Rocher, pink KitKat, "HAPPY BIRTHDAY" in gold on a white board |
| bar-mitzvah-13.jpg | "13" number cake, blue and white piping, Lindt truffles (landscape) |
| heart-strawberries.jpg | heart cream tart covered in chopped strawberries, black marble tray |
| ring-berries.jpg | ring tart, strawberries, blueberries, raspberries, silver chocolate bars, clear box |
| ring-shani.jpg | ring tart, three colours of cream, strawberries, blackberries, macarons, gold hearts |
| bomboloni-box.jpg | box of bomboloni: pistachio cream, dulce de leche cream, strawberries with whipped cream |
| bomboloni-box-2.jpg | the second box-of-bomboloni photo |
| bomboloni-oreo-mm.jpg | Oreo-cream bomboloni with powdered sugar next to chocolate-glazed doughnuts with M&M's |
| kunafa-cups.jpg | kunafa cups in martini glasses, gold tray, pistachios, gold spoons |
| vintage-30-side.jpg | white vintage cake, pink shell piping, pearls, baby's breath, gold "30", clear box with ribbon, from the side |
| vintage-30-top.jpg | the same vintage "30" cake from above |
| mini-ruffle-cakes.jpg | two small white ruffled cakes, gold pearls, gold candles, gold boards |
| name-cake-chen.jpg | white cake, "CHEN" in gold letters, white flowers, baby's breath, gold balls |
| name-cake-nissim.jpg | white cake, "NISSIM" in gold letters, black and gold pearls, two mini whisky bottles |
| marble-box-detail.jpg | close-up of the corner of a marble-print box holding a cream tart with macarons and dragon fruit |

Derived files (made by `scripts/images.py`, not photographed):

| File | How |
| --- | --- |
| marble-tile.jpg | `scripts/images.py tile`: front panel of the box from marble-box-detail.jpg, greyscale, levels pushed |
| og.jpg | `scripts/images.py og`: number-50-marble.jpg cropped to 1200×630 for link previews |
| NAME-480/960/1600.jpg + .webp | `scripts/images.py variants`: responsive sizes for `srcset` |
