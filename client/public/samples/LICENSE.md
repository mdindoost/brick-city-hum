# Sample provenance and licence

Every file in this directory was produced by `tools/fetch-samples.py` from the
**Versilian Community Sample Library (VCSL)**, released by Versilian Studios under
**CC0 1.0 Universal (public domain dedication)**.

- Source: https://github.com/sgossner/VCSL
- Licence: https://creativecommons.org/publicdomain/zero/1.0/
- Licence text as shipped with VCSL: https://github.com/sgossner/VCSL/blob/master/LICENSE

CC0 waives copyright entirely: no attribution is required. This note exists anyway,
because SPEC §12 asks for zero licensing exposure, and a reader of a public
repository should be able to see at a glance where the audio came from.

Files are named by **MIDI note number** — `72.m4a` is middle C. VCSL's own pitch
names put middle C at C3; the conversion is in the script, with a test that pins it.

Nothing else may be added here. SPEC §6.9 allows samples from VCSL and VSCO 2 CE
only, both CC0; anything else is a licence this project cannot carry.

## Kits

| directory | VCSL instrument | used for |
|---|---|---|
| `marimba/` | Marimba, outrigger mics | EWR departures — woody and definite; a rising figure needs each note to land |
| `vibraphone/` | Vibraphone, soft mallets | EWR arrivals — rounder, and it keeps ringing as it settles |
| `chimes/` | Tubular Bells 1 | overflights across the city — the one struck sound that reads as sustained |
| `glockenspiel/` | Glockenspiel | high overflights — barely audible shimmer, already in the right register |
| `harp/` | Concert Harp | distance-ring crossings — the quietest voice in the set, three or four per named event |

## Files

Peak is the source's **mono** peak in dBFS; gain is the lift applied to reach a −3 dBFS peak.

| file | VCSL source | layer | peak dBFS | gain dB | length s |
|---|---|---|---|---|---|
| `marimba/41.m4a` | `Marimba_hit_Outrigger_F1_med_01.wav` | med | -40.6 | +37.6 | 2.50 |
| `marimba/48.m4a` | `Marimba_hit_Outrigger_C2_med_01.wav` | med | -40.2 | +37.2 | 2.50 |
| `marimba/55.m4a` | `Marimba_hit_Outrigger_G2_med_01.wav` | med | -42.3 | +39.3 | 2.50 |
| `marimba/59.m4a` | `Marimba_hit_Outrigger_B2_med_01.wav` | med | -38.5 | +35.5 | 2.50 |
| `marimba/65.m4a` | `Marimba_hit_Outrigger_F3_soft_01.wav` | soft | -41.2 | +38.2 | 2.50 |
| `marimba/72.m4a` | `Marimba_hit_Outrigger_C4_soft_01.wav` | soft | -49.2 | +42.0 | 2.50 |
| `marimba/79.m4a` | `Marimba_hit_Outrigger_G4_soft_01.wav` | soft | -44.4 | +41.4 | 2.50 |
| `marimba/83.m4a` | `Marimba_hit_Outrigger_B4_med_01.wav` | med | -39.8 | +36.8 | 1.64 |
| `marimba/89.m4a` | `Marimba_hit_Outrigger_F5_med_01.wav` | med | -45.0 | +42.0 | 2.14 |
| `marimba/96.m4a` | `Marimba_hit_Outrigger_C6_med_01.wav` | med | -40.6 | +37.6 | 1.71 |
| `vibraphone/53.m4a` | `Vibes_soft_F2_v1_rr1_Main.wav` | v1 | -46.6 | +42.0 | 5.00 |
| `vibraphone/57.m4a` | `Vibes_soft_A2_v1_rr1_Main.wav` | v1 | -40.5 | +37.5 | 5.00 |
| `vibraphone/60.m4a` | `Vibes_soft_C3_v1_rr2_Main.wav` | v1 | -32.4 | +29.4 | 5.00 |
| `vibraphone/64.m4a` | `Vibes_soft_E3_v1_rr2_Main.wav` | v1 | -29.6 | +26.6 | 5.00 |
| `vibraphone/67.m4a` | `Vibes_soft_G3_v1_rr1_Main.wav` | v1 | -33.1 | +30.1 | 5.00 |
| `vibraphone/71.m4a` | `Vibes_soft_B3_v1_rr1_Main.wav` | v1 | -37.2 | +34.2 | 5.00 |
| `vibraphone/74.m4a` | `Vibes_soft_D4_v1_rr1_Main.wav` | v1 | -32.2 | +29.2 | 5.00 |
| `vibraphone/77.m4a` | `Vibes_soft_F4_v1_rr1_Main.wav` | v1 | -32.2 | +29.2 | 5.00 |
| `vibraphone/81.m4a` | `Vibes_soft_A4_v1_rr1_Main.wav` | v1 | -39.5 | +36.5 | 5.00 |
| `vibraphone/84.m4a` | `Vibes_soft_C5_v1_rr1_Main.wav` | v1 | -32.9 | +29.9 | 3.64 |
| `vibraphone/88.m4a` | `Vibes_soft_E5_v1_rr1_Main.wav` | v1 | -39.3 | +36.3 | 5.00 |
| `chimes/72.m4a` | `chimes_C3_pp_rr2.wav` | pp | -23.8 | +20.8 | 8.00 |
| `chimes/74.m4a` | `chimes_D3_pp_rr3.wav` | pp | -32.3 | +29.3 | 8.00 |
| `chimes/76.m4a` | `chimes_E3_pp_rr1.wav` | pp | -31.5 | +28.5 | 8.00 |
| `chimes/78.m4a` | `chimes_F#3_p_rr1.wav` | p | -24.1 | +21.1 | 8.00 |
| `chimes/80.m4a` | `chimes_G#3_p_rr2.wav` | p | -22.6 | +19.6 | 8.00 |
| `chimes/82.m4a` | `chimes_A#3_pp_rr1.wav` | pp | -32.4 | +29.4 | 8.00 |
| `chimes/84.m4a` | `chimes_C4_p_rr1.wav` | p | -25.5 | +22.5 | 8.00 |
| `chimes/86.m4a` | `chimes_D4_p_rr1.wav` | p | -28.6 | +25.6 | 8.00 |
| `chimes/88.m4a` | `chimes_E4_pp_rr3.wav` | pp | -38.6 | +35.6 | 8.00 |
| `glockenspiel/79.m4a` | `glock_soft_G4_01.wav` | soft | -38.6 | +35.6 | 4.00 |
| `glockenspiel/84.m4a` | `glock_soft_C5_02.wav` | soft | -41.2 | +38.2 | 4.00 |
| `glockenspiel/91.m4a` | `glock_soft_G5_01.wav` | soft | -36.9 | +33.9 | 4.00 |
| `glockenspiel/96.m4a` | `glock_soft_C6_01.wav` | soft | -37.8 | +34.8 | 4.00 |
| `glockenspiel/103.m4a` | `glock_soft_G6_01.wav` | soft | -38.5 | +35.5 | 3.32 |
| `glockenspiel/108.m4a` | `glock_soft_C7_03.wav` | soft | -38.3 | +35.3 | 4.00 |
| `harp/45.m4a` | `KSHarp_A2_mf1.wav` | mf | -30.4 | +27.4 | 3.00 |
| `harp/52.m4a` | `KSHarp_E3_mf1.wav` | mf | -30.0 | +27.0 | 3.00 |
| `harp/59.m4a` | `KSHarp_B3_mf1.wav` | mf | -25.4 | +22.4 | 3.00 |
| `harp/65.m4a` | `KSHarp_F4_mf1.wav` | mf | -22.8 | +19.8 | 3.00 |
| `harp/72.m4a` | `KSHarp_C5_mf1.wav` | mf | -20.3 | +17.3 | 3.00 |
| `harp/79.m4a` | `KSHarp_G5_mf1.wav` | mf | -26.9 | +23.9 | 3.00 |
| `harp/86.m4a` | `KSHarp_D6_mf1.wav` | mf | -23.1 | +20.1 | 3.00 |
| `harp/93.m4a` | `KSHarp_A6_mf1.wav` | mf | -26.8 | +23.8 | 3.00 |
| `harp/101.m4a` | `KSHarp_F7_f1.wav` | f | -17.2 | +14.2 | 1.87 |
