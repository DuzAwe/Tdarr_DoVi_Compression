# DoVi Flow MP4 → MKV Conversion Summary

## Changes Completed

### 1. Created New MKV Package Plugins
All package plugins now use `mkvmerge` instead of `MP4Box` with simplified syntax:

- **packageDoVi7Mkv** - Profile 7→8 conversion output
- **packageDoVi7MkvSingleLayer** - Single-layer P7→8 output  
- **packageDoViMkv** - Standard P4/5/8 output
- **packageHdr10PlusMkv** - HDR10+→DoVi conversion output

**Key Simplification:**
```bash
# Old MP4Box approach (complex)
MP4Box -add input.hevc:fps=23.976:timescale=24000:dvp=8.1 -brand mp42isom -ab dby1 output.mp4

# New mkvmerge approach (simple)
mkvmerge -o output.mkv input.hevc
```

**Why simpler?** mkvmerge auto-detects FPS and doesn't need DoVi flags since the RPU is already embedded in the HEVC bitstream after the inject stage.

### 2. Updated Audio Preservation Logic
Modified `ffmpegCommandRemuxMp4Dovi/1.0.0/index.js`:

- **For MP4**: Filters TrueHD/DCA audio (incompatible with MP4 container)
- **For MKV**: Preserves ALL audio streams including TrueHD/DCA
- Uses `args.variables.container` to determine target format
- Conditionally applies MP4-specific flags (`-movflags +faststart`, `-bsf:v hevc_mp4toannexb`)

### 3. Updated DoVi_Flow.json
- Changed container from `mp4` to `mkv` in node `ijOxQ9qo0`
- Disabled MP4 check node `-9dZgoCI3` (marked as "DISABLED for MKV workflow")
- Updated all 4 package plugin references to use new MKV variants
- Updated exit comment to reflect MKV workflow

## What Stayed the Same

### Extract/Inject Plugins - NO CHANGES NEEDED
All DoVi RPU extraction and injection plugins work identically for both MP4 and MKV:

- **extractDoViRpu** - Extracts RPU from HEVC to .rpu.bin
- **extractDoVi7Rpu** - Extracts Profile 7 RPU
- **extractDoVi7RpuSingleLayer** - Single-layer extraction
- **injectDoViRpu** - Injects RPU back into HEVC (P4/5/8)
- **injectDoVi7Rpu** - Handles P7→P8 conversion or dual-stream injection
- **injectDoVi7RpuSingleLayer** - Forces single-layer when HDR10 fallback missing
- **injectHdr10toDoVi8** - Converts HDR10+→DoVi P8
- **extractHDR10PlusMetadata** - Extracts HDR10+ JSON

**Why?** These all operate on raw HEVC bitstreams (container-agnostic). The DoVi RPU is embedded in HEVC NAL units, independent of the outer container format.

### NVENC Plugin
The previously created `nvencEncodeHevc` plugin works for both MP4 and MKV:
- Outputs raw HEVC with HDR metadata preserved
- 60% bitrate reduction (configurable)
- Fits between extract and inject stages

## Workflow Summary

```
Original File (MKV/MP4)
    ↓
Extract DoVi RPU → .rpu.bin file
    ↓
[OPTIONAL: NVENC Re-encode HEVC]
    ↓
Inject DoVi RPU → HEVC with embedded RPU
    ↓
Package with mkvmerge → Output .mkv with all audio
    ↓
FFmpeg Remux → Final .mkv with metadata + all audio streams
```

## Benefits of MKV

1. **Full Audio Support**: TrueHD, DCA (DTS-HD MA), Dolby Atmos - all preserved
2. **Simpler Packaging**: No complex DoVi flags needed (RPU already in HEVC)
3. **Better Compatibility**: Native DoVi support via embedded HEVC RPU
4. **Flexible Metadata**: Better subtitle, chapter, and attachment support

## Testing Checklist

- [ ] Test Profile 4/5/8 path with standard DoVi
- [ ] Test Profile 7→8 conversion path
- [ ] Test Profile 7 single-layer path
- [ ] Test HDR10+→DoVi conversion path
- [ ] Verify TrueHD audio preserved in output
- [ ] Verify DCA/DTS-HD MA audio preserved
- [ ] Test optional NVENC re-encode step
- [ ] Verify DoVi metadata intact in final MKV

## File Structure

```
FlowPlugins/LocalFlowPlugins/DoVI/
├── nvencEncodeHevc/1.0.0/index.js          ✅ NEW (optional re-encode)
├── packageDoVi7Mkv/1.0.0/index.js          ✅ NEW (replaces packageDoVi7Mp4)
├── packageDoVi7MkvSingleLayer/1.0.0/       ✅ NEW (replaces packageDoVi7Mp4SingleLayer)
├── packageDoViMkv/1.0.0/index.js           ✅ NEW (replaces packageDoViMp4)
├── packageHdr10PlusMkv/1.0.0/index.js      ✅ NEW (replaces packageHdr10PlusMp4)
├── ffmpegCommandRemuxMp4Dovi/1.0.0/        ✅ UPDATED (conditional audio filtering)
└── [all extract/inject plugins]           ✅ NO CHANGES (container-agnostic)
```

## Technical Notes

### Why Extract/Inject Still Needed for MKV?

Even though MKV natively supports DoVi, the extract→inject workflow is still necessary for:

1. **Re-encoding**: NVENC strips DoVi RPU during encode, requires re-injection
2. **Profile Conversion**: P7→P8 requires dovi_tool conversion
3. **HDR10+ Conversion**: Generating DoVi metadata from HDR10+ JSON
4. **Single-layer Fixes**: Forcing single-layer when HDR10 fallback missing

### mkvmerge vs MP4Box

| Feature | MP4Box | mkvmerge |
|---------|--------|----------|
| DoVi Flags | Required (`dvp=8.1`, `brand`, `timescale`) | Not needed |
| FPS Detection | Manual (`fps=23.976:timescale=24000`) | Automatic |
| Audio Support | Limited (no TrueHD/DCA) | All formats |
| Command Complexity | 7+ arguments | 3 arguments |

## Future Enhancements

- Add NVENC nodes to DoVi_Flow.json for optional re-encoding
- Create configuration for bitrate reduction percentage
- Add quality presets (high/medium/low bitrate)
- Support for AV1 encoding (future codec support)
