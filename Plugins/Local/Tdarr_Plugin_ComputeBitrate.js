/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
const details = () => ({
  id: 'Tdarr_Plugin_ComputeBitrate',
  Stage: 'Pre-processing',
  Name: 'Compute Bitrate (ffprobe fallback)',
  Type: 'Other',
  Operation: 'Inspect',
  Description: 'Reads ffprobe bit_rate (format or stream) and falls back to size/duration. Writes currentBitrate/targetBitrate/minimumBitrate/maximumBitrate into flow variables (kbps).',
  Version: '1.1',
  Tags: 'inspect,bitrate,ffprobe',
  Inputs: [],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = (() => {
    try { return require('../methods/lib')(); } catch (e) { return { loadDefaultValues: (a,b)=>a }; }
  })();
  inputs = lib.loadDefaultValues(inputs, details);

  const response = {
    processFile: false,
    preset: '',
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: '',
  };

  // determine duration in seconds
  let durationSeconds = 0;
  try {
    if (parseFloat(file.ffProbeData?.format?.duration) > 0) {
      durationSeconds = parseFloat(file.ffProbeData.format.duration);
    } else if (typeof file.meta?.Duration !== 'undefined' && Number(file.meta.Duration) > 0) {
      durationSeconds = Number(file.meta.Duration);
    } else if (file.ffProbeData?.streams?.[0]?.duration) {
      durationSeconds = parseFloat(file.ffProbeData.streams[0].duration);
    }
  } catch (e) {
    durationSeconds = 0;
  }

  // get bitrate in bits/sec: prefer format.bit_rate, then first stream, then fallback to size/duration
  let bitRateBps = 0;
  try {
    if (file.ffProbeData?.format?.bit_rate && Number(file.ffProbeData.format.bit_rate) > 0) {
      bitRateBps = Number(file.ffProbeData.format.bit_rate);
    } else if (file.ffProbeData?.streams?.[0]?.bit_rate && Number(file.ffProbeData.streams[0].bit_rate) > 0) {
      bitRateBps = Number(file.ffProbeData.streams[0].bit_rate);
    } else if (file.file_size && durationSeconds > 0) {
      // file.file_size assumed bytes; compute bits/sec
      bitRateBps = (Number(file.file_size) * 8) / durationSeconds;
    }
  } catch (e) {
    bitRateBps = 0;
  }

  const currentBitrate = bitRateBps ? Math.round(bitRateBps / 1000) : 0; // kbps
  const targetBitrate = Math.round(currentBitrate / 2);
  const minimumBitrate = Math.round(targetBitrate * 0.7);
  const maximumBitrate = Math.round(targetBitrate * 1.3);

  // Store in both file.meta AND flow variables for persistence
  try {
    if (!file.meta) file.meta = {};
    file.meta.currentBitrate = currentBitrate;
    file.meta.targetBitrate = targetBitrate;
    file.meta.minimumBitrate = minimumBitrate;
    file.meta.maximumBitrate = maximumBitrate;
  } catch (e) {}

  // Set flow variables for downstream plugins
  response.variables = {
    currentBitrate,
    targetBitrate,
    minimumBitrate,
    maximumBitrate,
  };

  response.infoLog += `Computed bitrates (kbps): current=${currentBitrate} target=${targetBitrate} min=${minimumBitrate} max=${maximumBitrate}\n`;
  response.processFile = false;
  response.reQueueAfter = false;
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;