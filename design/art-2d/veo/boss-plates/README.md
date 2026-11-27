# Boss start plates

Four 1254 × 1254 RGBA PNGs for image-to-video animation. Front views walk down-right toward the camera. Back views walk up-right away from it.

| Plate | Atlas reference (row, column) | Painted height |
| --- | --- | ---: |
| [glacier_warden-front.png](glacier_warden-front.png) | [Glacier Warden](../../chapter4/glacier_warden.webp) (1, 2) | 1157 px |
| [glacier_warden-back.png](glacier_warden-back.png) | [Glacier Warden](../../chapter4/glacier_warden.webp) (2, 2) | 1132 px |
| [eclipse_sovereign-front.png](eclipse_sovereign-front.png) | [Eclipse Sovereign](../../chapter5/eclipse_sovereign.webp) (1, 2) | 1174 px |
| [eclipse_sovereign-back.png](eclipse_sovereign-back.png) | [Eclipse Sovereign](../../chapter5/eclipse_sovereign.webp) (2, 2) | 1164 px |

## Generation prompts

Each built-in image generator call received the shared prompt followed by the corresponding view prompt, with an enlarged crop of the indicated atlas cell as its image reference. Row and column numbers start at one.

### Shared prompt

Hand-paint one high-resolution full-body start frame for Skyhold Isles. The supplied enlarged atlas cell is the exact visual model. Repaint its design, proportions, specific shapes, colors, stance and camera faithfully with fresh, crisp painted detail at full resolution. One character centered on an immaculate uniform, opaque pure magenta (#FF00FF) color-key background extending into every gap. Square canvas at least 1024 px, silhouette about 90–94% of canvas height with clear air all around. Steep three-quarter game camera from above, neutral walking mid-stride, both boots visible. Opaque storybook gouache, broad modeled color planes and subtle drybrush, thin warm ink contours, chalky light from upper left. Keep the silhouette clean and readable at sprite size. No floor, contact shadow, background texture, magenta bounce, detached particles, stray marks, letters, props, or other figures.

### glacier_warden-front

Glacier Warden, front three-quarter view walking diagonally down-right toward camera. Preserve the squat, nearly square silhouette, tiny blunt faceted head with pinprick pale gold eye, heavy grey-brown basalt arms with huge stone fists, two short block legs, and the compact crowns of chunky pale glacier-blue crystals on both shoulders. In the center of the rock chest is one small square pale-cyan luminous glass lantern in a chunky dark bronze frame with four corner bosses. Keep the brow and face as simple as the reference.

### glacier_warden-back

Glacier Warden, rear three-quarter view walking diagonally up-right away from camera, so the near heel lies down-left of the far forward foot. Paint the nearly square silhouette, backs of both thick basalt fists, back of the tiny blunt head, two pale glacier-blue crystal shoulder crowns, and the broad solid warm slate-grey back with a few large fractured stone planes. Both legs individually readable, one boot following the other. The lantern and face are fully hidden on the far side.

### eclipse_sovereign-front

Eclipse Sovereign, front three-quarter view stepping diagonally down-right toward camera in a relaxed walking stride. Match the broad compact figure in warm blackened-plum armor, original angular enclosed helm with amber slit, wide antique-gold crescent gorget, paired stepped folded-gold pauldrons, articulated gauntlets and heavy boots. Place the solid round black sun immediately behind the helmet, partially obscured by helmet and shoulders, with a continuous tight gold-white burning rim and orange tapered corona. Original dark muted plum split cape with sparse golden star specks trails to the left. Keep the corona edge distinct for chroma keying.

### eclipse_sovereign-back

Eclipse Sovereign, rear three-quarter view stepping diagonally up-right away from camera. The surface nearest the camera is the back of the long, split muted plum cape, sweeping slightly left in heavy broad folds with a few soft gold four-point stars and pinpricks. Two heavy boots visible beneath, one nearer, one receding. Preserve the original broad compact proportions, paired stepped antique-gold pauldrons and armored gauntlets. Only the back of the helm is visible. Behind it the round black sun has a continuous close burning gold-white rim with orange tapered corona. Keep that edge distinct for chroma keying.

## Export

The magenta was keyed to straight alpha. Soft edges retain partial coverage, including the tips of the Sovereign’s corona. The keyed plates were checked against the atlas cells at sprite size and composited on light and dark backgrounds for edge review.
