# Skybridge Gauntlet

The northern road crosses two arches to the garrison. A teal pennant above the stair matches the cloth on the middle pier. The southern road returns to the keep over a single arch with a sun keystone. The sundial on the western ridge comes from the intro. The keeper has stacked dry wood by the beacon for the evening signal in the outro.

## Rebuild

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i07
```

Each `archBridges` entry in the island recipe gives the painting, the west and east deck centres, the distances from the lane to the top and bottom of the painting, and the near curb's distance below the lane. All measurements are in layout pixels. The compositor shears the deck along the road and keeps the piers vertical. A bank in front of a pier hides its masonry down to the bottom of the painting. The rock spur under the northern pier belongs to the terrain.

## Source paintings

The built-in image generator produced the following original scenery. The entrance finish registers to the shipping cave silhouette and mouth. The gate actor mask uses the same aperture at both resolutions.

| Source | Painting brief and preparation |
| --- | --- |
| `terrain-i07.webp`, `land-i07.webp` | Two sunlit limestone plateaux with a deep, narrow stream between them. Break their edges into fractured golden rock with blue-grey faces, patches of thyme and olive grass. A second painting restored the cliffs' vertical fractures after fitting the two bridgeheads. The land mask follows the finished lips. |
| `gorge-ledge.webp` | Projecting meadow turf and a steep broken limestone face, lit from the upper left. The compositor extends a ledge only where a tower ring needs footing. A cutting seats the intermediate pier against the eastern bank of the upper crossing. |
| `landmark-thyme-bridge.webp` | Two arches in dressed limestone. Ivy and pink flowers pick out one springing. A teal cloth hangs on the central pier. Match the road's stone colour and register the walking surface between the two parapets. |
| `landmark-sun-bridge.webp` | A single recessed arch in a solid curtain of interlocking stone. Its short bronze-capped posts and carved sun face the player. The thick arch casts a cool shadow under the span. |
| `tex-span-paving.webp` | Weathered limestone setts partly buried in pale gravel. Four long strips from the painting run along the lane in succession so the stone courses turn with the road. |
| `landmark-span-garrison.webp`, `landmark-garrison-stairs.webp` | A low stone garrison with square turrets, slate roof, amber windows and teal pennant. A separate worn stair descends from its doorway to the eastern approach. |
| `landmark-cliff-sundial.webp` | A bronze gnomon casts its shadow across the incised radial markings of a golden limestone dial. Keep the triangular gnomon legible on the phone. |
| `landmark-span-woodstore.webp` | An unlit iron basket on a stepped plinth beside a slate-roofed store of split logs. A fire rake rests against the woodpile. |
| `thyme-postern-s.webp` | Fit a limestone arch into the northern cave. Cut a little wave crest above the opening and let thyme grow in the stone joints. Register both jambs and the lintel to the original entrance. |
