/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
const details = () => ({
  id: 'Tdarr_Plugin_FlowHDR_AdaptiveSoftware_SDR',
  Stage: 'Pre-processing',
  Name: 'FlowHDR Adaptive Software SDR',
  Type: 'Video',
  Operation: 'Transcode',
  Description: 'Adaptive libx265 software encode for SDR with CRF+VBV bitrate constraints matching NVENC behavior.',
  Version: '1.0',
  Tags: 'flowhdr,sdr,libx265,adaptive,software',
  Inputs: [
    { name: 'container', type: 'string', defaultValue: 'original', inputUI: { type: 'text' },
      tooltip: 'Output container. original = keep.' },
    { name: 'bitrate_cutoff', type: 'string', defaultValue: '', inputUI: { type: 'text' },
      tooltip: 'Skip encode if current bitrate below this (kbps). Empty disables.' },
    { name: 'enable_10bit', type: 'boolean', defaultValue: false, inputUI: { type: 'dropdown', options: ['false','true'] },
      tooltip: 'Force 10bit (p010le).' },
    { name: 'force_conform', type: 'boolean', defaultValue: false, inputUI: { type: 'dropdown', options: ['false','true'] },
      tooltip: 'Remove unsupported streams for target container.' },
    { name: 'crf', type: 'string', defaultValue: '19', inputUI: { type: 'text' },
      tooltip: 'x265 CRF value (0-51, lower = higher quality).' },
    { name: 'preset', type: 'string', defaultValue: 'medium', inputUI: { type: 'text' },
      tooltip: 'x265 preset: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow.' },
  ],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = (() => { try { return require('../methods/lib')(); } catch { return { loadDefaultValues: (a)=>a }; } })();
  inputs = lib.loadDefaultValues(inputs, details);
  const r = {
    processFile: false,
    preset: '',
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: true,
    infoLog: '',
  };

  if (file.fileMedium !== 'video') { r.infoLog+='Skip: not video.\n'; return r; }

  // Compute bitrate
  let durationSeconds = 0;
  try {
    if (file.ffProbeData?.format?.duration) durationSeconds = Number(file.ffProbeData.format.duration);
  } catch { /* ignore */ }
  if (!durationSeconds || durationSeconds <= 0) {
    r.infoLog+='Skip: unable to determine duration.\n';
    return r;
  }

  let bitRateBps = 0;
  try {
    if (file.ffProbeData?.format?.bit_rate) {
      bitRateBps = Number(file.ffProbeData.format.bit_rate);
    } else if (file.ffProbeData?.streams?.[0]?.bit_rate) {
      bitRateBps = Number(file.ffProbeData.streams[0].bit_rate);
    } else if (file.file_size && durationSeconds > 0) {
      bitRateBps = (Number(file.file_size) * 8) / durationSeconds;
    }
  } catch { /* ignore */ }

  const currentBitrate = bitRateBps ? Math.round(bitRateBps / 1000) : 0;
  if (currentBitrate === 0) {
    r.infoLog+='Skip: unable to determine bitrate.\n';
    return r;
  }

  const targetBitrate = Math.round(currentBitrate / 2);
  const minimumBitrate = Math.round(targetBitrate * 0.8);
  const maximumBitrate = Math.round(targetBitrate * 1.5);
  const bufSize = Math.round(maximumBitrate * 2);

  // Bitrate cutoff
  if (inputs.bitrate_cutoff !== '') {
    const cutoff = parseInt(inputs.bitrate_cutoff, 10);
    if (!Number.isNaN(cutoff) && currentBitrate < cutoff) {
      r.infoLog+=`Skip: currentBitrate ${currentBitrate} < cutoff ${cutoff}.\n`;
      return r;
    }
  }

  // Container
  const outContainer = inputs.container === 'original' ? file.container : inputs.container;
  r.container = `.${outContainer}`;

  // genpts for ts/avi
  let genpts = '';
  if (['ts','avi'].includes(outContainer.toLowerCase())) genpts='-fflags +genpts ';

  // Stream conform + picture removal
  let extraMaps = '';
  let vidIdx = 0;
  const streams = file.ffProbeData?.streams || [];
  streams.forEach((s)=>{
    if (s.codec_type?.toLowerCase()==='video') {
      if (['mjpeg','png'].includes((s.codec_name||'').toLowerCase())) extraMaps += `-map -v:${vidIdx} `;
      vidIdx++;
    }
  });

  if (inputs.force_conform) {
    if (outContainer.toLowerCase()==='mp4') {
      streams.forEach((s,i)=>{
        const n=(s.codec_name||'').toLowerCase();
        if (['hdmv_pgs_subtitle','eia_608','subrip','timed_id3'].includes(n)) extraMaps+=`-map -0:${i} `;
      });
    } else if (outContainer.toLowerCase()==='mkv') {
      streams.forEach((s,i)=>{
        const n=(s.codec_name||'').toLowerCase();
        if (['mov_text','eia_608','timed_id3','data'].includes(n)) extraMaps+=`-map -0:${i} `;
      });
    }
  }

  // Pixel format
  const pixFmt = inputs.enable_10bit ? '-pix_fmt yuv420p10le' : '';

  // Build x265-params with VBV constraints
  const vbvParams = `vbv-maxrate=${maximumBitrate}:vbv-bufsize=${bufSize}`;
  const x265Params = `profile=main10:${vbvParams}`;

  // Build preset
  const crf = inputs.crf;
  const preset = inputs.preset;
  r.preset = `${genpts}<io> -map 0 -c:v libx265 -preset ${preset} -crf ${crf} ${pixFmt} -bf 5 -x265-params "${x265Params}" -fps_mode passthrough -c:a copy -c:s copy -max_muxing_queue_size 9999 ${extraMaps}`.trim();

  r.processFile = true;
  r.infoLog += `SDR Software adaptive: crf=${crf} preset=${preset} cur=${currentBitrate} target=${targetBitrate} vbv-max=${maximumBitrate}\n`;
  return r;
};

module.exports.details = details;
module.exports.plugin = plugin;
