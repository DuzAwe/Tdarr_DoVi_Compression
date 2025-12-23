# Tdarr_DoVi_Processing

A set of Tdarr plugins that can handle Dolby Vision videos in **Profiles 4, 5, 7, 8**, and **HDR10+**, remuxing and re-encoding with NVENC into MKV files aiming for a 60% reduction in size. This project originated from andrasmaroy’s [Tdarr_Plugins_DoVi](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi) & nichols89ben [Tdarr_Plugins_DoVi](https://github.com/nichols89ben/Tdarr_DoVi_Processing). I spent a number of weeks adding the NVENC process testing accross all DV Profiles.

---

## Overview

Many Users could save GBs with no noticable drop in quality. 

- **Goal**: Preserve Dolby Vision whenever possible while ensuring the file remains playable on LG TVs and other devices.  
- **Main Approach**:  
  - Filter or identify DV files (Profiles 4, 5, 7, 8) and HDR10+ content.  
  - If DV Profile 7 lacks HDR10 fallback metadata, optionally convert it from dual-layer to single-layer (Profile 8.1).  
  - Repack or transcode as needed, then remux into MP4 with correct DoVi flags.

This README explains how the **Extract → Inject → Package** (or skip steps if not needed) pipeline works, which ensures safer playback on LG TVs and the Nvidia Shield.

---

## Key Features

1. **Handles DV Profiles 4/5/7/8 & HDR10+.**  
2. **Preserves original Dolby Vision profiles** — no forced P7→P8 conversion unless explicitly selected (HDR10+ lane only).  
3. **Optional fallback detection** (checks if ST 2086 / MaxCLL / Master Display info is present).  
4. **Profile 7** can remain dual-layer or be converted to single-layer if fallback is missing.  
5. **HDR10+** → DV Profile 8 conversion using `hdr10plus_tool` (isolated to HDR10+ lane).  
6. **All subtitle types preserved** in final remux (SubRip, PGS, etc.) — no sidecar files created.  
7. **NVENC re-encoding** with adaptive bitrate and HDR metadata preservation (color primaries, transfer characteristics, mastering display, MaxCLL).  
8. **Remux preserves original non-video streams** — only the video stream is replaced; audio, subtitles, chapters, and metadata remain unchanged.

---

## Plugin Flow (High-Level)

1. **Check HDR type**  
   - Identifies if file is DV, HDR10+, HDR10, or SDR via MediaInfo.  
2. **Check DoVi Profile**  
   - Determines Profile 4, 5, 7 (single/dual-layer), or 8.  
3. **Check for HDR10 fallback**  
   - Looks for Mastering Display / ST 2086 / CLL. If missing, flags it.  
4. **Extract / Reorder streams**  
   - Reorders streams and extracts raw HEVC video only. Subtitles remain untouched for final remux.  
5. **NVENC Encode**  
   - Re-encodes HEVC with adaptive bitrate, preserving HDR metadata (color primaries, transfer characteristics, mastering display, MaxCLL).  
6. **Extract & Inject RPU**  
   - **Profile 4/5/8**: Extract RPU with `dovi_tool extract-rpu`, inject back with `inject-rpu`. **Original profile preserved.**  
   - **Profile 7**: Extract with `extractDoVi7Rpu` (no `-m 2`), inject with `injectDoVi7Rpu`. **Profile 7 remains Profile 7.**  
   - **HDR10+**: Extract HDR10+ metadata to JSON, convert to DV Profile 8 via `injectHdr10toDoVi8`.  
7. **Wrap with mkvmerge**  
   - Wraps injected HEVC in video-only MKV with timestamps to protect DV NALs.  
8. **Remux with ffmpeg**  
   - Maps video from wrapped MKV and audio/subtitles/chapters/metadata from original file. Final output is MKV.

---

## Detailed Plugins

Below is a quick summary of each plugin used in the flow. Many are adapted from [andrasmaroy/Tdarr_Plugins_DoVi](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi) with modifications:

1. **Check HDR Type**  
   - Determines if the file is Dolby Vision, HDR10+, HDR10, or SDR by scanning MediaInfo.  
   - **Enhanced** to detect DV via `HDR_Format_Profile` (e.g., `dvhe.08.06`) and prefer DV when both DV and HDR10+ are present (common in P8.1 files).
   - Adjusted to handle SMPTE ST 2094 (HDR10+) properly.

2. **Check DoVi Profile**  
   - Inspects Dolby Vision to see if it’s Profile 4, 5, 7, or 8.  
   - Unmodified from the original version.

3. **Check HDR10 Fallback Metadata**  
   - Detects missing fallback (e.g., `cll=0,0` or no mention of ST 2086 / Master Display).  
   - Flags if fallback is absent.

4. **ffmpeg - Reorder Streams DoVi**  
   - Reorders audio/subtitle/video streams so the video stream is last.  
   - Helps certain DoVi injection steps that rely on a fixed stream order.

5. **ffmpeg - Extract Streams DoVi**  
   - Extracts raw HEVC video only. Subtitles are **not** extracted as sidecar files.  
   - All original subtitle streams (SubRip, PGS, etc.) are preserved in the final remux via `-map 1:s?`.

6. **Extract DoVi RPU / Inject DoVi RPU / Wrap & Remux MKV**  
   - For **Profiles 4/5/8**: Extract RPU with `dovi_tool extract-rpu`, inject back with `dovi_tool inject-rpu`. No forced `-m 2` usage. **Original profile is preserved.**
   - For **Profile 7**: 
     - **Extract DoVi 7 RPU** (dual-layer) without `-m 2` to preserve HDR10 fallback.  
     - **Inject DoVi RPU 7** (always uses `inject-rpu`; no conversion to single-layer unless explicitly selected).  
     - **Wrap with mkvmerge** (video-only MKV with timestamps) to protect DV NALs.  
     - **Remux with ffmpeg** mapping video from wrapped MKV + audio/subs/chapters/metadata from original file.
   - **Profile 7 remains Profile 7; no implicit P7→P8 conversion.**

7. **Processing HDR10+**  
   - **Extract HDR10+ Metadata** → .json using `hdr10plus_tool`.  
   - **Inject HDR10+ as DoVi P8** → Convert it to DV Profile 8.  
   - **Wrap & Remux** the new DV (Profile 8) track in MKV.

8. **Remux DoVi MKV**  
   - Maps video from the wrapped MKV (output of step 6) and audio/subtitles/chapters/metadata from the original file.  
   - Uses `-c copy` for all streams to avoid re-encoding. All audio codecs (including TrueHD/DTS-HD) are preserved.  
   - Final container is MKV; original file is replaced with the new MKV.

---

## Common Flows

**Short version**:  
[Input File] → [Extract raw HEVC stream] → [Extract Dolby Vision RPU] → [NVENC re-encode HEVC with HDR fallback preserved] → [Inject DV RPU] → [Wrap with mkvmerge (video-only MKV)] → [Remux with ffmpeg (video from wrapped MKV + audio/subs/chapters from original)]

**Key points:**
- **Profile preservation**: Profile 7 inputs produce Profile 7 outputs; Profile 8 inputs produce Profile 8 outputs. No implicit conversion.
- **HDR10+ lane**: Only the HDR10+ branch converts to DV Profile 8 via `injectHdr10toDoVi8`.
- **NVENC encoding**: Adaptive bitrate with HDR metadata (color primaries, transfer, mastering display, MaxCLL) preserved via `-master-display` and `-max-cll`.
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
