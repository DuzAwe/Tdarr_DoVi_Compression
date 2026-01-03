# Tdarr_DoVi_Processing

A set of Tdarr plugins and a flow that can handle Dolby Vision videos in **Profiles 4, 5, 7, 8**, and **HDR10+**, remuxing and re-encoding with NVENC into MKV files aiming for a 30% - 50% reduction in size. This project originated from andrasmaroy's [Tdarr_Plugins_DoVi](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi) & nichols89ben [Tdarr_Plugins_DoVi](https://github.com/nichols89ben/Tdarr_DoVi_Processing). I spent a number of weeks adding the NVENC process, BPP cut off and testing across all DV Profiles.

---

## Overview

Many users could save GBs with no noticeable drop in quality. As such I have also aimed to balance time & electricity cost into the flow. Adding the BPP filter to skip files that are well compressed already, not just to reduce the likelihood of lost visual quality but also to prevent looping forever trying to hit a file size that isn't possible.  

- **Goal**: Preserve Dolby Vision and reduce file size where possible.   
- **Main Approach**:
  - Filter already well-optimized files (anything under BPP of 0.15)
  - Filter or identify DV files (Profiles 4, 5, 7, 8) and HDR10+ content.  
  - If DV Profile 7 lacks HDR10 fallback metadata, optionally convert it from dual-layer to single-layer (Profile 8.1).  
  - Repack or transcode as needed, then remux into MKV with correct DoVi flags. (built with the Nvidia Sheild in mind)

This README explains how the **Extract → Inject → Package** (or skip steps if not needed) pipeline works, which ensures safer playback on LG TVs and the Nvidia Shield.

---

## Key Features

1. **BPP-based efficiency filter** — skips re-encoding files already well-compressed (BPP < 0.15) to save processing time and prevent quality loss.
2. **Handles DV Profiles 4/5/7/8 & HDR10+.**  
3. **Preserves original Dolby Vision profiles** — no forced P7→P8 conversion unless explicitly selected (HDR10+ lane only).  
4. **Optional fallback detection** (checks if ST 2086 / MaxCLL / Master Display info is present).  
5. **Profile 7** can remain dual-layer or be converted to single-layer if fallback is missing.  
6. **HDR10+** → DV Profile 8 conversion using `hdr10plus_tool` (isolated to HDR10+ lane).  
7. **All subtitle types preserved** in final remux (SubRip, PGS, etc.) — no sidecar files created.  
8. **NVENC re-encoding** with adaptive bitrate and HDR metadata preservation (color primaries, transfer characteristics, mastering display, MaxCLL).  
9. **Remux preserves original non-video streams** — only the video stream is replaced; audio, subtitles, chapters, and metadata remain unchanged.

---

## Plugin Flow (High-Level)

1. **Check HDR type**  
   - Identifies if file is DV, HDR10+, HDR10, or SDR via MediaInfo.  
2. **Check BPP Efficiency**  
   - Calculates bits-per-pixel (BPP) from video bitrate, resolution, and framerate.
   - Skips encoding if BPP < 0.15 (already well-compressed).
   - Prevents unnecessary processing and potential quality loss on efficient files.
3. **Check DoVi Profile**  
   - Determines Profile 4, 5, 7 (single/dual-layer), or 8.  
4. **Check for HDR10 fallback**  
   - Looks for Mastering Display / ST 2086 / CLL. If missing, flags it.  
5. **Extract / Reorder streams**  
   - Reorders streams and extracts raw HEVC video only. Subtitles remain untouched for final remux.  
6. **NVENC Encode**  
   - Re-encodes HEVC with adaptive bitrate, preserving HDR metadata (color primaries, transfer characteristics, mastering display, MaxCLL).  
7. **Extract & Inject RPU**
   - **Profile 4/5/8**: Extract RPU with `dovi_tool extract-rpu`, inject back with `inject-rpu`. **Original profile preserved.**  
   - **Profile 7**: Extract with `extractDoVi7Rpu` (no `-m 2`), inject with `injectDoVi7Rpu`. **Profile 7 remains Profile 7.**  
   - **HDR10+**: Extract HDR10+ metadata to JSON, convert to DV Profile 8 via `injectHdr10toDoVi8`.  
8. **Wrap with mkvmerge**  
   - Wraps injected HEVC in video-only MKV with timestamps to protect DV NALs.  
9. **Remux with ffmpeg**
   - Maps video from wrapped MKV and audio/subtitles/chapters/metadata from original file. Final output is MKV.

---

## Detailed Plugins

Below is a quick summary of each plugin used in the flow. Many are adapted from [andrasmaroy/Tdarr_Plugins_DoVi](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi) with modifications:

1. **Check HDR Type**  
   - Determines if the file is Dolby Vision, HDR10+, HDR10, or SDR by scanning MediaInfo.  
   - **Enhanced** to detect DV via `HDR_Format_Profile` (e.g., `dvhe.08.06`) and prefer DV when both DV and HDR10+ are present (common in P8.1 files).
   - Adjusted to handle SMPTE ST 2094 (HDR10+) properly.

2. **Check BPP Efficiency**  
   - Calculates bits-per-pixel (BPP) from video bitrate, resolution, and framerate.
   - Default threshold: **0.15 BPP** (optimized for 4K HDR content).
   - Skips encoding if BPP is below threshold (file already well-compressed).
   - Uses video-only bitrate (prioritizes extracted stream `format.size` calculation).
   - Prevents wasted processing time and potential quality degradation on already-efficient encodes.
   - Placed after Requeue (on DoVi node) but before any extraction/encoding work.

3. **Check DoVi Profile**
   - Inspects Dolby Vision to see if it’s Profile 4, 5, 7, or 8.  
   - Unmodified from the original version.

4. **Check HDR10 Fallback Metadata**  
   - Detects missing fallback (e.g., `cll=0,0` or no mention of ST 2086 / Master Display).  
   - Flags if fallback is absent.

5. **ffmpeg - Reorder Streams DoVi**  
   - Reorders audio/subtitle/video streams so the video stream is last.  
   - Helps certain DoVi injection steps that rely on a fixed stream order.

6. **ffmpeg - Extract Streams DoVi**  
   - Extracts raw HEVC video only. Subtitles are **not** extracted as sidecar files.  
   - All original subtitle streams (SubRip, PGS, etc.) are preserved in the final remux via `-map 1:s?`.

7. **Extract DoVi RPU / Inject DoVi RPU / Wrap & Remux MKV**
   - For **Profiles 4/5/8**: Extract RPU with `dovi_tool extract-rpu`, inject back with `dovi_tool inject-rpu`. No forced `-m 2` usage. **Original profile is preserved.**
   - For **Profile 7**: 
     - **Extract DoVi 7 RPU** (dual-layer) without `-m 2` to preserve HDR10 fallback.  
     - **Inject DoVi RPU 7** (always uses `inject-rpu`; no conversion to single-layer unless explicitly selected).  
     - **Wrap with mkvmerge** (video-only MKV with timestamps) to protect DV NALs.  
     - **Remux with ffmpeg** mapping video from wrapped MKV + audio/subs/chapters/metadata from original file.
   - **Profile 7 remains Profile 7; no implicit P7→P8 conversion.**

8. **Processing HDR10+**  
   - **Extract HDR10+ Metadata** → .json using `hdr10plus_tool`.  
   - **Inject HDR10+ as DoVi P8** → Convert it to DV Profile 8.  
   - **Wrap & Remux** the new DV (Profile 8) track in MKV.

9. **Remux DoVi MKV**  
   - Maps video from the wrapped MKV (output of step 7) and audio/subtitles/chapters/metadata from the original file.  
   - Uses `-c copy` for all streams to avoid re-encoding. All audio codecs (including TrueHD/DTS-HD) are preserved.  
   - Final container is MKV; original file is replaced with the new MKV.

10. **Size Check & Software Fallback**  
   - After the final remux, the flow checks if the output file is larger than the original.
   - If the output is larger, the flow automatically restarts with **x265 software encoding** instead of NVENC.
   - This ensures you always get the smallest possible file without sacrificing quality.

---

## NVENC vs x265 Encoding Strategy

The flow uses a **two-tier encoding approach** to balance speed and file size:

### Primary Path: NVENC (Hardware Encoding)
- **Fast**: Uses hardware acceleration for quick encoding
- **Efficient**: Works well for most files, achieving ~60% size reduction
- **Adaptive bitrate**: Automatically calculates target bitrate based on source
- **HDR preservation**: Maintains all color metadata, mastering display, and MaxCLL
- **Fixed GOP**: Enforces `-g 600 -keyint_min 600` with `-strict_gop 1` for consistent 600-frame keyframe spacing
- **Lean rate control**: `-rc-lookahead 32`, `-tune hq`; all AQ flags removed for stability and efficiency
- **Robust init**: Applies `-weighted_pred 1` only when B-frames are disabled to avoid NVENC HEVC init errors

### Fallback Path: x265 (Software Encoding)
- **Triggered automatically** if NVENC output is larger than the original file
- **Better compression**: Uses slower presets (default: `slow`, CRF 18) for maximum quality per bit
- **Same quality settings**: Preserves all HDR metadata identically to NVENC
- **Re-reads original**: Restarts from the original library file to ensure clean source
- **Decode-friendly**: Adds `-tune fastdecode`
- **Predictable GOP**: Uses fixed `-g 600` while preserving scene-cut keyframes (no `keyint_min`)

### How the Fallback Works
1. File completes NVENC encoding and remux
2. `checkFileNotBigger` plugin compares output size to original
3. If output > original:
   - Error is caught and reset
   - `use_x265` variable is set to `true`
   - Flow restarts from the beginning
4. On restart, `checkUseX265` nodes detect the variable and route to x265 branches
5. x265 re-encodes from the original source with software compression
6. Final output is guaranteed to be smaller (or same quality if already optimal)

### Configuration
Both NVENC and x265 paths use the same default quality settings:
- **CRF**: 18 (lower = better quality, range 0-51)
- **Preset**: 
  - NVENC: `p7` (highest quality hardware preset)
  - x265: `slow` (balanced speed/compression)
- **Pixel format**: `p010le` (10-bit)
- **HDR params**: BT.2020 color primaries, SMPTE 2084 transfer, mastering display, MaxCLL
- **Adaptive bitrate**: 60% of source (with 1.5x maxrate buffer)
- **GOP & tune**:
   - NVENC: `-g 600 -keyint_min 600 -strict_gop 1 -tune hq -rc-lookahead 32` (AQ removed)
   - x265: `-g 600 -tune fastdecode` (scene-cut keyframes still allowed)

You can adjust these in the flow nodes if needed.

---

## Recent Improvements (Dec 2025)

After additional testing across diverse Dolby Vision sources, the encoding settings have been refined for better efficiency and stability:

- **NVENC (hevc_nvenc):**
   - Added fixed GOP: `-g 600 -keyint_min 600` plus `-strict_gop 1` for consistent segmenting
   - Removed AQ flags (`-spatial_aq`, `-temporal-aq`, `-aq-strength`) to improve efficiency and avoid edge cases
   - Kept `-rc-lookahead 32` and `-tune hq` for strong rate control and quality
   - Conditional `-weighted_pred 1` only when B-frames are disabled to prevent NVENC init errors
   - **Increased min bitrate multiplier from 0.5 to 0.8** for tighter rate control and more consistent compression
   - Bitrate calculation now uses extracted stream size (video-only) instead of container bitrate
   - Retains adaptive bitrate caps and HDR metadata preservation

- **x265 (libx265):**
   - Uses fixed `-g 600` (no `keyint_min`) to allow scene-cut keyframes for quality on cuts
   - Enforces VBV when adaptive bitrate is active; preserves HDR mastering and MaxCLL
   - Bitrate calculation prioritizes extracted stream size for accurate video-only targets

Overall result: smaller or equal file sizes with steadier playback characteristics, improved hardware encoder reliability, and consistent GOP structure across both lanes.

## Encoding Parameters & Defaults

### NVENC (Hardware) Encoder
- **CQ (Constant Quality)**: `21` (range 0-51, lower = better quality)
- **Bitrate Reduction**: `0.7` (70% of source video bitrate)
- **Min Rate Multiplier**: `0.8` (minimum bitrate = 80% of target)
- **Max Rate Multiplier**: `1.5` (maximum bitrate = 150% of target)
- **B-frames**: Enabled (better compression)
- **Multipass**: Enabled (fullres, ~2× encode time, 10-15% size reduction)
- **GOP Size**: Fixed 600 frames (~25s @ 24fps)
- **Preset**: `p7` (highest quality)
- **RC Mode**: VBR + CQ

**Example Bitrate Calculation:**
- Source: 10,000 kbps video
- Target: 10,000 × 0.7 = 7,000 kbps
- Min: 7,000 × 0.8 = 5,600 kbps
- Max: 7,000 × 1.5 = 10,500 kbps
- After remuxing audio (~600 kbps): ~7,600 kbps total (24% reduction)

### x265 (Software) Encoder
- **CRF (Constant Rate Factor)**: `18` (range 0-51, lower = better quality)
- **Bitrate Reduction**: `0.6` (60% of source video bitrate)
- **Preset**: `slow` (better compression than medium)
- **GOP Size**: Fixed 600 frames with scene-cut detection
- **VBV Enforcement**: When adaptive bitrate enabled, sets `vbv-maxrate` and `vbv-bufsize` to enforce caps

**When x265 is Used:**
- NVENC size check fails (output larger than original)
- Hardware encoder not available
- User explicitly routes to software encode

### HDR Metadata Preservation (Both Encoders)
- Color primaries: BT.2020
- Transfer characteristics: SMPTE 2084 (PQ)
- Color space: BT.2020nc
- Mastering display metadata (G/B/R/WP/L values)
- MaxCLL and MaxFALL light levels

---

## Common Flows

**Short version**:  
[Input File] → [Requeue to DoVi Node] → **[Check BPP Efficiency]** → [Extract raw HEVC stream] → [Extract Dolby Vision RPU] → [NVENC re-encode HEVC with HDR fallback preserved] → [Inject DV RPU] → [Wrap with mkvmerge (video-only MKV)] → [Remux with ffmpeg (video from wrapped MKV + audio/subs/chapters from original)] → **[Size Check]** → [Replace Original] or [Restart with x265]

**Key points:**
- **Profile preservation**: Profile 7 inputs produce Profile 7 outputs; Profile 8 inputs produce Profile 8 outputs. No implicit conversion.
- **HDR10+ lane**: Only the HDR10+ branch converts to DV Profile 8 via `injectHdr10toDoVi8`.
- **NVENC encoding**: Adaptive bitrate with HDR metadata (color primaries, transfer, mastering display, MaxCLL) preserved via `-master-display` and `-max-cll`.
- **x265 fallback**: If NVENC output is larger, flow automatically restarts with x265 software encoding from the original file.
- **Size guarantee**: Final output is always smaller than or equal to the original file size.
- **Wrapping step**: `mkvmerge` creates a video-only MKV with timestamps to protect DV NALs before final remux.
- **Final remux**: Maps video from wrapped MKV (`-map 0:v`) and audio/subs/chapters/metadata from original file (`-map 1:a`, `-map 1:s?`, `-map_chapters 1`, `-map_metadata 1`).
  

---

## Docker Image / Environment

Because we need `dovi_tool`, `hdr10plus_tool`, and `mkvmerge`, a **custom Docker image** is needed:

- **GHCR (preferred)**: `ghcr.io/duzawe/dovi-tdarr-node:latest`  
- The compose file can default to GHCR via `TDARR_NODE_IMAGE`, but you can point it to any registry.

### Pulling from GHCR

Use a GitHub Personal Access Token (PAT) with `read:packages` (and `write:packages` if you plan to push):

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
docker pull ghcr.io/duzawe/dovi-tdarr-node:latest
```

### Example Docker Compose
**- Included in this repo**

To use GitHub Container Registry (GHCR) for the DoVi node image, set an environment variable and login to GHCR:

```bash
# Login to GHCR (requires a GitHub Personal Access Token with "read:packages")
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin

# Choose your image (replace org/name and tag as appropriate)
export TDARR_NODE_IMAGE="ghcr.io/your-org/dovi-tdarr-node:latest"

# Then bring up compose
docker compose up -d
```

The compose file uses `image: ${TDARR_NODE_IMAGE:-ghcr.io/your-org/dovi-tdarr-node:latest}` so you can override per environment without editing the file.

### Installing Plugins

1. Clone or download this repository.
2. Copy the `DoVi` folder into your local Flow Plugins directory:

**/path/to/server/Tdarr/Plugins/FlowPlugins/LocalFlowPlugins/DoVi**

3. **Important**: Do not place them in the “community” folder, as updates may overwrite them.

---

### Tdarr Flow JSON

- A sample **Flow JSON** is included in this repository.
- To import it into Tdarr:
1. Go to “Flow” → “Import Flow.”
2. Paste the JSON file provided, which includes the chain of plugins as described above.

---

### Notes & Tips

- **Important for Non-Tdarr Pro Users**  
  The `Requeue` and `Node Tags` features are Pro-only. However, DoVi plugins require the correct DoVi version to function properly. Without Pro, here's what you can do:

  1. In your `docker-compose` file, disable the internal node:
     ```yaml
     - internalNode=false
     - inContainer=false
     ```
  2. Run separate nodes alongside the server using the custom image:
     ```yaml
     tdarr_DoVi-node:
          image: ghcr.io/duzawe/dovi-tdarr-node:latest
       container_name: tdarr_DoVi-node
     ```
     You can add more nodes if needed:
     ```yaml
     tdarr_DoVi-node2:
          image: ghcr.io/duzawe/dovi-tdarr-node:latest
       container_name: tdarr_DoVi-node2
     ```
  3. Remove or disable the `Requeue for DoVi Node` step in the flow.

  For more details, see the [Tdarr Docker Compose Docs](https://docs.tdarr.io/docs/installation/docker/run-compose#compose).
  <br>
- **Requeue to a DoVi Node**  
  Ensure your node is tagged (e.g., `DoVi_Yeezy`) to use the correct environment. Configure it under:  

  **Custom Node > Options > Node Tags > DoVi_Yeezy**  

  Adjust tag names as needed for your specific setup or hardware (CPU/GPU).  
  <br>
- **Make This the Last Flow**  
Further processing on the MKV file may overwrite/corrupt the DoVi metadata. Best to use this flow at the end of your pipeline.  
  <br>
- **MediaInfo Scan Required**  
Ensure MediaInfo scanning is enabled in your Tdarr library settings. The flow relies on MediaInfo's `HDR_Format_Profile` (e.g., `dvhe.08.06`) to correctly detect Dolby Vision. Without MediaInfo, DV files may be misrouted to the Non-HDR lane.  
  <br>
- **Profile Preservation Policy**  
This flow preserves the original Dolby Vision profile. Profile 7 inputs produce Profile 7 outputs; Profile 8 inputs produce Profile 8 outputs. Only the HDR10+ lane explicitly converts to Profile 8 via `injectHdr10toDoVi8`. No implicit P7→P8 conversion occurs.  
  <br>
- **Subtitle Handling**  
All original subtitle streams (SubRip, PGS, etc.) are preserved in the final remux. No sidecar `.srt` files are created.  
  
  <br>
- **Replacing the Original File**  
Certain steps reference the original file for final packaging. If you’ve done prior processing, be sure to replace the original so it doesn’t revert your changes.

---

## References

- [**Tdarr_Plugins_DoVi** (original)](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi)  
- [**dvmkv2mp4**](https://github.com/gacopl/dvmkv2mp4)  
- [**dovi_tool**](https://github.com/quietvoid/dovi_tool)  
- [**MP4Box** GPAC Wiki](https://wiki.gpac.io/MP4Box/MP4Box/)  
- [**hdr10plus_tool**](https://github.com/quietvoid/hdr10plus_tool)
