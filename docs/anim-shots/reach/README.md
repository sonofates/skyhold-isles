# Plot reach after the strict pan clamp (f81c9197)

Measured with the logic of tests/render/plotReach.test.ts (pure: real hudDock + fullBleedFitItems, hero on, belt 0 or
3 items, no insets), pan limited to the art only (= before the fix). A plot is unreachable when no pan offset puts its
tap circle (the part painted on the map) on screen and under no HUD piece. Format: plot(blocking pieces); horn = horn
at its dock spot (in game it normally stands by the cave, clear of plots). 390x844 portrait: none. After the fix: none
at any viewport. Last block: the reach past the art the fix grants (px: bottom, top, right, left; #islands using it).

In-game check (qa/reachshots.mjs on preview builds): before/ = base build, after/ = fix; *-default = default view,
*-best = pan spot where the plot is clear (any band there is the mirrored painted edge, no frame).

```
unreachable before (art-only pan): {('1280x720', 'items=0'): 2, ('800x600', 'items=0'): 18, ('844x390', 'items=0'): 81, ('1920x1080', 'items=3'): 6, ('1366x768', 'items=3'): 8, ('1280x720', 'items=3'): 9, ('800x600', 'items=3'): 47, ('844x390', 'items=3'): 97} total 268

### 1280x720 items=0
| i09 | 10(tray) |
| i16 | 11(tray) |

### 800x600 items=0
| i04 | 16(tray+horn+banner) |
| i13 | 1(tray+horn+banner), 3(tray+horn+banner), 5(plaque+tray+horn+banner), 6(plaque+tray+horn), 8(plaque+tray) |
| i14 | 3(plaque+tray), 4(plaque+tray+horn), 17(tray+horn+banner) |
| i15 | 10(tray+horn+banner), 11(tray+horn+banner), 13(plaque+tray+horn+banner) |
| i21 | 17(plaque+tray+horn+banner) |
| i23 | 20(plaque+tray) |
| i24 | 13(plaque+tray+horn+banner), 18(plaque+tray+horn+banner), 19(tray+horn+banner), 20(tray+horn+banner) |

### 844x390 items=0
| l1c | 16(tray), 17(tray), 18(tray), 19(tray) |
| i02 | 18(tray) |
| i03 | 6(buttons), 10(horn), 12(tray), 19(tray), 20(tray) |
| i04 | 15(tray), 16(tray) |
| i05 | 8(tray), 9(tray), 10(tray), 12(tray) |
| i06 | 2(tray), 3(tray), 5(tray) |
| i07 | 8(buttons), 18(tray), 24(tray) |
| i08 | 7(buttons), 12(horn), 16(tray), 17(tray), 19(tray), 21(tray) |
| i09 | 8(tray), 10(tray), 11(tray), 12(tray), 15(horn), 19(buttons) |
| i10 | 2(tray), 4(tray) |
| i11 | 14(tray), 22(tray), 23(tray) |
| i12 | 20(horn), 24(tray), 26(tray) |
| i13 | 3(tray), 5(tray), 6(tray) |
| i14 | 4(tray), 17(tray), 18(tray) |
| i15 | 11(tray), 12(tray), 13(tray) |
| i16 | 10(tray), 11(tray), 12(tray), 14(tray) |
| i17 | 8(buttons), 16(tray), 17(tray) |
| i18 | 14(tray), 15(tray), 16(tray), 18(tray) |
| i19 | 8(tray), 15(tray), 16(tray), 17(tray) |
| i20 | 11(tray), 16(tray) |
| i21 | 5(buttons), 17(tray) |
| i22 | 14(tray), 16(tray), 17(tray), 19(horn) |
| i23 | 11(horn), 13(tray), 14(tray), 18(tray) |
| i24 | 13(tray), 16(tray), 18(tray) |

### 1920x1080 items=3
| i03 | 20(tray) |
| i06 | 3(tray) |
| i09 | 10(tray) |
| i13 | 5(tray) |
| i16 | 11(tray) |
| i21 | 17(tray) |

### 1366x768 items=3
| l1c | 17(tray) |
| i03 | 20(tray) |
| i06 | 3(tray) |
| i09 | 10(tray) |
| i13 | 5(tray) |
| i16 | 11(tray) |
| i19 | 17(tray) |
| i21 | 17(tray) |

### 1280x720 items=3
| l1c | 17(tray) |
| i03 | 20(tray) |
| i06 | 3(tray) |
| i09 | 10(tray) |
| i10 | 4(tray) |
| i13 | 5(tray) |
| i16 | 11(tray) |
| i19 | 17(tray) |
| i21 | 17(tray) |

### 800x600 items=3
| l1c | 16(plaque+tray), 17(plaque+tray+banner+horn), 19(tray+banner+horn) |
| i02 | 17(plaque+tray), 18(plaque+tray) |
| i03 | 11(tray+banner+horn), 18(plaque+tray), 19(plaque+tray) |
| i04 | 16(tray+banner+horn) |
| i05 | 9(plaque+tray+banner+horn), 10(tray+banner+horn) |
| i06 | 1(tray+banner+horn), 2(tray+banner+horn), 3(plaque+tray+banner+horn) |
| i07 | 17(tray+banner+horn), 18(tray+banner+horn), 25(plaque+tray) |
| i08 | 15(tray+banner+horn), 17(plaque+tray+banner+horn) |
| i09 | 8(plaque+tray), 10(plaque+tray+banner+horn), 11(plaque+tray+banner+horn), 12(tray+banner+horn) |
| i10 | 2(plaque+tray) |
| i11 | 21(plaque+tray), 22(plaque+tray) |
| i12 | 26(plaque+tray) |
| i13 | 1(tray+banner+horn), 3(tray+banner+horn), 5(plaque+tray+banner+horn), 6(plaque+tray), 8(plaque+tray) |
| i14 | 3(plaque+tray) |
| i15 | 10(tray+banner+horn), 11(tray+banner+horn), 13(plaque+tray+banner+horn) |
| i16 | 10(plaque+tray) |
| i19 | 15(tray+banner+horn), 16(plaque+tray+banner+horn), 17(plaque+tray+banner+horn) |
| i21 | 17(plaque+tray+banner+horn) |
| i22 | 16(plaque+tray+banner+horn), 17(tray+banner+horn) |
| i23 | 13(tray+banner+horn) |
| i24 | 13(plaque+tray+banner+horn), 18(plaque+tray+banner+horn), 19(tray+banner+horn) |

### 844x390 items=3
| l1c | 16(tray), 17(tray), 18(tray), 19(tray), 20(tray) |
| i02 | 17(tray), 18(tray) |
| i03 | 6(buttons), 10(horn), 11(tray), 12(tray), 19(tray), 20(tray) |
| i04 | 15(tray), 16(tray), 18(tray) |
| i05 | 8(tray), 9(tray), 10(tray), 12(tray) |
| i06 | 0(tray+banner+horn), 1(tray), 2(tray), 3(tray), 5(tray) |
| i07 | 8(buttons), 17(tray), 18(tray), 24(tray), 25(tray) |
| i08 | 7(buttons), 12(horn), 15(tray), 16(tray), 17(tray), 19(tray), 21(tray) |
| i09 | 8(tray), 10(tray), 11(tray), 12(tray), 15(horn), 19(buttons) |
| i10 | 1(tray), 2(tray), 4(tray) |
| i11 | 14(tray), 22(tray), 23(tray) |
| i12 | 20(horn), 24(tray), 26(tray) |
| i13 | 1(tray), 3(tray), 5(tray), 6(tray) |
| i14 | 4(tray), 17(tray), 18(tray) |
| i15 | 2(tray), 11(tray), 12(tray), 13(tray) |
| i16 | 10(tray), 11(tray), 12(tray), 14(tray) |
| i17 | 8(buttons), 16(tray), 17(tray+horn), 19(horn) |
| i18 | 14(tray), 15(tray), 16(tray), 18(tray) |
| i19 | 8(tray), 14(tray), 15(tray), 16(tray), 17(tray) |
| i20 | 11(tray), 16(tray) |
| i21 | 5(buttons), 17(tray) |
| i22 | 14(tray), 16(tray), 17(tray), 19(horn) |
| i23 | 11(horn), 13(tray), 14(tray), 18(tray), 20(tray) |
| i24 | 13(tray), 16(tray), 18(tray), 19(tray) |

max reach (bottom, top, right, left px) and #islands with reach:
('1920x1080', 'items=0') [0, 0, 0, 0, 0]
('1366x768', 'items=0') [0, 0, 5.0, 0, 1]
('1280x720', 'items=0') [10.0, 0, 7.0, 5.0, 3]
('800x600', 'items=0') [56.0, 0, 0, 2.0, 7]
('844x390', 'items=0') [75.0, 5.0, 32.0, 60.0, 24]
('390x844', 'items=0') [0, 0, 0, 0, 0]
('1920x1080', 'items=3') [88.0, 0, 83.0, 0, 6]
('1366x768', 'items=3') [66.0, 0, 71.0, 0, 8]
('1280x720', 'items=3') [71.0, 0, 42.0, 0, 9]
('800x600', 'items=3') [59.0, 0, 0, 2.0, 22]
('844x390', 'items=3') [75.0, 4.0, 64.0, 55.0, 24]
('390x844', 'items=3') [0, 0, 0, 0, 0]
```
