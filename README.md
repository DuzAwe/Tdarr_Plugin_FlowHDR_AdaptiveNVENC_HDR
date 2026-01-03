# TdarrConfig - HDR/SDR NVENC BitRate Compression

Custom Tdarr configuration for intelligent video compression with HDR/SDR detection and adaptive NVENC/software encoding fallback.

Companion project: For advanced Dolby Vision (DoVi) workflows and more complex DoVi compression support, see https://github.com/DuzAwe/Tdarr_DoVi_Compression. Use this Flow for HDR10/SDR and pair with the DoVi repo when sources contain Dolby Vision. If not needed, you can remove the "Go To Flow" node from the flow configuration. 

## Overview

This project provides a Tdarr Flow configuration that:
- Checks video encoding efficiency (bits per pixel) to skip already well-compressed files
- Automatically detects HDR vs SDR content
- Detects source codec (h264 vs h265) for intelligent bitrate targeting
- Performs fast NVENC hardware encoding as the primary pass
- Falls back to high-quality software encoding (libx265) when hardware compression is insufficient
- Preserves HDR metadata and color information
- Cleans up audio/subtitle/image streams

## Project Structure

```
TdarrConfig/
├── README.md                                     # This file
├── FlowHDR.json                                  # Main flow configuration
└── Plugins/
    └── Local/
        ├── Tdarr_Plugin_ComputeBitrate.js        # Bitrate calculation utility
        ├── Tdarr_Plugin_FlowHDR_AdaptiveNVENC_HDR.js   # HDR NVENC encoding
        └── Tdarr_Plugin_FlowHDR_AdaptiveNVENC_SDR.js   # SDR NVENC encoding
```

## Flow Logic

### 1. **Input & Preparation**
- Set baseline file reference for size comparison
- Remove embedded images
- Clean audio tracks (keep eng, und, jpn)
- Clean subtitles
- Reorder streams
- **BPP Efficiency Check**: Calculates bits per pixel (BPP) to identify already well-compressed files
  - Files with BPP < 0.1 are skipped (already efficiently encoded)
  - Prevents re-encoding files that won't benefit from further compression

### 2. **HDR Detection**
- **Check filename for DV/DOVI keywords**: Files containing "DV" or "DOVI" in the filename are routed to a separate Dolby Vision flow
  - If DV/DOVI detected → Routes to companion DoVi flow (requires DoVi flow setup)
  - If not detected → Continues to HDR metadata check
- **Check video stream metadata for HDR**: Analyzes stream properties for HDR10 characteristics
  - HDR detected → Routes to HDR encoding path
  - No HDR → Routes to SDR encoding path with codec detection

### 3. **Codec Detection (SDR Path Only)**
For SDR content, the flow detects the source video codec to apply intelligent compression:
- **h264/x264**: More aggressive compression (50% target) - these codecs are less efficient, allowing more size reduction
- **h265/hevc**: Conservative compression (70% target) - already well-compressed, requires gentler approach

### 4. **Hardware Encoding (Fast Pass)**

**HDR Content:**
- Routes to `Tdarr_Plugin_FlowHDR_AdaptiveNVENC_HDR`
- Uses NVENC hevc with 10-bit encoding
- Preserves HDR10 metadata, color primaries (bt2020), and transfer characteristics
- Default CQ: 20
- Bitrate target: 70% of source

**SDR Content:**
- Routes to `Tdarr_Plugin_FlowHDR_AdaptiveNVENC_SDR` with codec-aware targeting
- Uses NVENC hevc with 10-bit encoding
- h264 sources: CQ 18, 50% bitrate target
- h265 sources: CQ 20, 70% bitrate target

### 5. **Size Comparison**
After NVENC encoding, the flow compares the output file size against the **original input file** (captured at the start):
- **Output ≤ Original**: Hardware encode succeeded → Proceed to healthcheck
- **Output > Original**: Hardware encode too large → Route to software encode

> **Important:** The comparison uses the original file as the baseline throughout the entire flow, NOT the hardware-encoded output. This ensures both hardware and software passes are measured against the same source.

### 6. **Software Encoding (Quality Pass)**
If hardware encoding didn't sufficiently reduce file size:

**SDR Software Pass:**
```bash
ffmpeg -c:v libx265 -preset slow -crf 20 -bf 5 -x265-params profile=main10
```
- Uses conservative 60% bitrate target (between h264 and h265 targets)
- CRF 20 for balanced quality-constrained encoding
- 10-bit encoding for better compression efficiency

**HDR Software Pass:**
```bash
ffmpeg -c:v libx265 -preset slow -crf 20 -pix_fmt p010le -bf 5 
  -x265-params "profile=main10:hdr10=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc"
```
- 70% bitrate target matching HDR NVENC
- CRF 20 for balanced encoding
- Preserves all HDR10 metadata

After software encoding, the output is compared again against the **original file**. If still larger, the loop continues (though typically software encoding succeeds).

### 7. **Finalization**
- Healthcheck (thorough scan)
- Replace original file with compressed output

## Custom Plugins

### Tdarr_Plugin_ComputeBitrate.js
**Purpose:** Calculates video bitrate from ffprobe data or file size/duration.

**Outputs (Flow Variables):**
- `currentBitrate` (kbps)
- `targetBitrate` (kbps)
- `minimumBitrate` (kbps)
- `maximumBitrate` (kbps)

### Tdarr_Plugin_FlowHDR_AdaptiveNVENC_HDR.js
**Purpose:** Hardware-accelerated NVENC encoding for HDR content.

**Features:**
- Preserves HDR10 metadata
- Forces 10-bit encoding (p010le)
- Configurable CQ, B-frames, bitrate cutoff
- Adaptive bitrate calculation
 - Optional full-resolution multipass
- Weighted prediction automatically enabled only when B-frames are disabled

**Parameters:**
- `container`: Output container (default: original)
- `bitrate_cutoff`: Skip encoding if below threshold (kbps)
- `enable_bframes`: Enable NVENC B-frames (default: true)
- `multipass_fullres`: Enable `-multipass fullres` (default: true)
**Features:**
- Optional 10-bit encoding for better compression
- Configurable CQ, B-frames, bitrate cutoff
- Adaptive bitrate calculation
 - Optional full-resolution multipass
- Weighted prediction automatically enabled only when B-frames are disabled

**Parameters:**
- `container`: Output container (default: original)
- `bitrate_cutoff`: Skip encoding if below threshold (kbps)
- `enable_10bit`: Force 10-bit encoding (default: false)
- `enable_bframes`: Enable NVENC B-frames (default: true)
- `multipass_fullres`: Enable `-multipass fullres` (default: true)
### 1. Copy Custom Plugins
Copy the plugin files to your Tdarr server:

```bash
# Docker
cp Plugins/Local/*.js /path/to/tdarr/server/Plugins/Local/

# Bare Metal
cp Plugins/Local/*.js /opt/tdarr/server/Plugins/Local/
```

### 2. Import Flow
1. Open Tdarr Web UI
2. Navigate to **Flows** tab
3. Click **Import Flow**
4. Select `FlowHDR.json`
5. Assign the flow to your library

### 3. Configure Library Settings
Ensure your library has:
- **Transcode cache**: Enabled with sufficient space
- **Hardware acceleration**: NVENC available (Nvidia GPU required)
- **FFmpeg**: Recent version with hevc_nvenc support

## Requirements

### Hardware
- **GPU**: Nvidia GPU with NVENC support (Pascal/Turing/Ampere/Ada)
- **CPU**: Any modern CPU for software fallback encoding

### Software
- **Tdarr**: v2.x with Flow support
- **FFmpeg**: v4.4+ compiled with `--enable-nvenc` and `--enable-libx265`
- **Drivers**: Nvidia driver 450+ (Linux) or 452+ (Windows)

### Dependencies (Community Plugins)
The flow uses these community plugins (auto-installed by Tdarr):
- `Tdarr_Plugin_MC93_MigzImageRemoval`
- `Tdarr_Plugin_MC93_Migz3CleanAudio`
- `Tdarr_Plugin_MC93_Migz4CleanSubs`
- `Tdarr_Plugin_MC93_Migz6OrderStreams`
- `Tdarr_Plugin_00td_action_handbrake_ffmpeg_custom`

## Configuration Tips

### Adjusting Compression Quality

**NVENC (Hardware):**
- Lower CQ = Higher quality, larger files (range: 0-51)
- Default CQ 18 (h264) and CQ 20 (h265/HDR) balance quality/size
- Modify in flow JSON: `"cq": "20"`

**libx265 (Software):**
- Lower CRF = Higher quality, larger files (range: 0-51)
- Default CRF 20 for both HDR and SDR
- Modify in flow JSON: `"crf": "20"`

**BPP Efficiency Threshold:**
- Default 0.1 bits per pixel
- Lower threshold = stricter (skip more files)
- Higher threshold = more lenient (encode more files)
- Modify in flow JSON: `"bpp_threshold": "0.1"`

### Bitrate Cutoff
Skip encoding files already below target bitrate:
- Set `bitrate_cutoff` parameter in plugin config
- Example: `"bitrate_cutoff": "5000"` skips files below 5 Mbps

### Preset Tuning
**NVENC:** Uses `p7` preset (best quality) by default in plugins  
**Software:** `slow` (HDR) and `medium` (SDR) balance speed/quality

Additional NVENC optimizations used:
- `-rc-lookahead 32` retained (optimal for target GPUs)
- `-multipass fullres` (toggleable)
- `-weighted_pred 1` when B-frames are disabled (automatically controlled)
 - `-g 600 -keyint_min 600` fixed GOP for consistent keyframe spacing

## Troubleshooting

### NVENC Encoding Fails
- Verify GPU supports NVENC: `nvidia-smi`
- Check FFmpeg build: `ffmpeg -encoders | grep hevc_nvenc`
- Ensure driver version meets minimum requirements

### HDR Metadata Not Preserved
- Confirm source has HDR metadata: `ffprobe -show_streams input.mkv`
- Verify HDR plugin is being used (check Tdarr logs)
- Ensure container supports HDR (MKV, MP4 with proper flags)

### File Size Increases
- Normal for hardware encoding on already-compressed files
- Software fallback should activate automatically
- Check "Compare File Size" node routing in flow

### Loop Detected
If a file keeps re-encoding:
- Check that `reQueueAfter: false` is set in flow nodes
- Verify healthcheck passes
- Review Tdarr logs for errors

## Workflow Diagram

```
Input File
    ↓
Set Original File (baseline for comparison)
    ↓
Clean Streams (images/audio/subs/order)
    ↓
BPP Efficiency Check (< 0.1?) ──── Yes → Skip (already efficient)
    ↓
    No
    ↓
Check Filename for DV/DOVI? ──── Yes → Go To DoVi Flow (separate workflow)
    ↓
    No
    ↓
Check HDR? ─── Yes → HDR NVENC (CQ 20, 70%) → Compare vs Original
    │                                                ↓
    │                                     Smaller? → Healthcheck
    │                                                ↓
    │                                      Not Smaller → Software HDR (CRF 20, 70%)
    │
    └─── No (SDR) → Detect Codec?
                        │
                        ├─ h264 → SDR NVENC (CQ 18, 50%) → Compare vs Original
                        │                                          ↓
                        │                               Not Smaller → Software SDR (CRF 20, 60%)
                        │
                        └─ h265 → SDR NVENC (CQ 20, 70%) → Compare vs Original
                                                                   ↓
                                                        Not Smaller → Software SDR (CRF 20, 60%)
                                                                   ↓
                                                              Healthcheck
                                                                   ↓
                                                           Replace Original
```

## Performance Notes

- **NVENC Encoding:** ~2-5x real-time speed (depending on GPU/resolution)
- **Software Encoding:** ~0.5-2x real-time speed (depending on CPU/preset)
- **Typical Flow Time:** 30-60 minutes for 2-hour 1080p HDR movie
- **Space Savings:** 30-60% average file size reduction

## Recent Tuning & Results

Through additional testing, these changes improved perceived quality and efficiency while maintaining detail:
- **BPP efficiency check:** Added bits-per-pixel analysis to skip already well-compressed files (BPP < 0.1), preventing unnecessary re-encoding.
- **Codec-aware adaptive targeting:** Flow-level detection routes h264 sources to 50% compression (aggressive) and h265 sources to 70% compression (conservative) to match codec efficiency characteristics.
- **Adjusted quality levels:** CQ 18 for h264 (more aggressive), CQ 20 for h265/HDR (balanced); CRF 20 for all software encoding.
- **Removed explicit AQ controls:** Simplifies NVENC behavior and avoids over/under-weighting; quality improved across mixed content.
- **Consistent GOP:** All encoders now use `-g 600 -keyint_min 600` for predictable keyframes and smoother seeking behavior.
- **Hardware-accelerated decoding:** Added `-hwaccel cuda` to all encoding paths for GPU-accelerated decoding.
- **Weighted prediction conditional:** Enabled only without B-frames to maintain compatibility.

Net effect: efficient pre-filtering, codec-appropriate compression targets, cleaner motion, stable textures, reliable seeking, and continued size reductions without noticeable artifacts in typical sources.

## License

Custom plugins are provided as-is for personal use. Community plugins retain their original licenses.

## Credits

- Based on Migz MC93 plugin series
- Adapted for FlowHDR workflow with size comparison logic
- NVENC parameters optimized for quality preservation

---

**Version:** 1.2  
**Last Updated:** January 3, 2026
