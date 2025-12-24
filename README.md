# TdarrConfig - HDR/SDR NVENC BitRate Compression

Custom Tdarr configuration for intelligent video compression with HDR/SDR detection and adaptive NVENC/software encoding fallback.

## Overview

This project provides a Tdarr Flow configuration that:
- Automatically detects HDR vs SDR content
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

### 2. **HDR Detection**
- Check filename for DV/DOVI keywords
- Check video stream metadata for HDR

### 3. **Hardware Encoding (Fast Pass)**

**HDR Content:**
- Routes to `Tdarr_Plugin_FlowHDR_AdaptiveNVENC_HDR`
- Uses NVENC hevc with 10-bit encoding
- Preserves HDR10 metadata, color primaries (bt2020), and transfer characteristics
- Default CQ: 18

**SDR Content:**
- Routes to `Tdarr_Plugin_FlowHDR_AdaptiveNVENC_SDR`
- Uses NVENC hevc with configurable 8-bit or 10-bit
- Default CQ: 18

### 4. **Size Comparison**
After NVENC encoding, the flow compares the output file size against the **original input file** (captured at the start):
- **Output ≤ Original**: Hardware encode succeeded → Proceed to healthcheck
- **Output > Original**: Hardware encode too large → Route to software encode

> **Important:** The comparison uses the original file as the baseline throughout the entire flow, NOT the hardware-encoded output. This ensures both hardware and software passes are measured against the same source.

### 5. **Software Encoding (Quality Pass)**
If hardware encoding didn't sufficiently reduce file size:

**SDR Software Pass:**
```bash
ffmpeg -c:v libx265 -preset medium -crf 19 -bf 5 -x265-params profile=main10
```

**HDR Software Pass:**
```bash
ffmpeg -c:v libx265 -preset slow -crf 18 -pix_fmt p010le -bf 5 
  -x265-params "profile=main10:hdr10=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc"
```

After software encoding, the output is compared again against the **original file**. If still larger, the loop continues (though typically software encoding succeeds).

### 6. **Finalization**
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

**Parameters:**
- `container`: Output container (default: original)
- `bitrate_cutoff`: Skip encoding if below threshold (kbps)
- `enable_bframes`: Enable NVENC B-frames (default: true)
- `force_conform`: Remove incompatible streams (default: false)
- `cq`: NVENC CQ value (default: 21)

### Tdarr_Plugin_FlowHDR_AdaptiveNVENC_SDR.js
**Purpose:** Hardware-accelerated NVENC encoding for SDR content.

**Features:**
- Optional 10-bit encoding for better compression
- Configurable CQ, B-frames, bitrate cutoff
- Adaptive bitrate calculation

**Parameters:**
- `container`: Output container (default: original)
- `bitrate_cutoff`: Skip encoding if below threshold (kbps)
- `enable_10bit`: Force 10-bit encoding (default: false)
- `enable_bframes`: Enable NVENC B-frames (default: true)
- `force_conform`: Remove incompatible streams (default: false)
- `cq`: NVENC CQ value (default: 21)

## Installation

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
- Default CQ 18 (HDR) and 21 (SDR) balance quality/size
- Modify in flow JSON: `"cq": "18"`

**libx265 (Software):**
- Lower CRF = Higher quality, larger files (range: 0-51)
- Default CRF 18 (HDR) and 19 (SDR)
- Modify in flow JSON: `"-crf 18"`

### Bitrate Cutoff
Skip encoding files already below target bitrate:
- Set `bitrate_cutoff` parameter in plugin config
- Example: `"bitrate_cutoff": "5000"` skips files below 5 Mbps

### Preset Tuning
**NVENC:** Uses `p7` preset (best quality) by default in plugins  
**Software:** `slow` (HDR) and `medium` (SDR) balance speed/quality

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
Check HDR? ─── Yes → HDR NVENC Encode → Compare vs Original
    │                                         ↓
    └─── No → SDR NVENC Encode → Compare vs Original
                                         ↓
                            Smaller? ─── Yes → Healthcheck → Replace Original
                                 │
                                 └─── No → Software Encode → Compare vs Original
                                                   ↓
                                          Smaller? → Healthcheck → Replace Original
```

## Performance Notes

- **NVENC Encoding:** ~2-5x real-time speed (depending on GPU/resolution)
- **Software Encoding:** ~0.5-2x real-time speed (depending on CPU/preset)
- **Typical Flow Time:** 30-60 minutes for 2-hour 1080p HDR movie
- **Space Savings:** 30-60% average file size reduction

## License

Custom plugins are provided as-is for personal use. Community plugins retain their original licenses.

## Credits

- Based on Migz MC93 plugin series
- Adapted for FlowHDR workflow with size comparison logic
- NVENC parameters optimized for quality preservation

---

**Version:** 1.0  
**Last Updated:** December 24, 2025
